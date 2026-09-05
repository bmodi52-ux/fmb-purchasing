-- Writing an expense is one fact, so it should be one transaction.
--
-- It was seven or more. createExpense inserted the parent row, then looped
-- over the line items inserting them one at a time, then inserted the status
-- history row, each as its own PostgREST round trip with its own chance to
-- fail. updateExpense was worse: it deleted every line item and then
-- re-inserted them one by one, so an interruption anywhere in that loop left
-- an expense holding *some* of its lines, with a total that no longer matched
-- them and no indication anything had gone wrong.
--
-- For an accounting record that is the wrong failure mode. It also cost
-- 1 + 2N round trips to a database on the other side of the country, on the
-- one action every submitter performs.
--
-- Moving it into the database buys three things at once: atomicity, a single
-- round trip, and somewhere to enforce the invariant that the rest of the
-- system now depends on — that the line items sum to the recorded total
-- (0026). That check belongs here rather than in the form alone, because the
-- form is not the only thing that can write an expense, and an invariant that
-- reporting relies on should not be enforceable only by the caller that
-- happens to be well-behaved.
--
-- Item and category matching stay in application code and arrive resolved.
-- They involve fuzzy text matching against learned vendor wordings (0023) and
-- have their own tests; reimplementing them in plpgsql would move working,
-- covered logic into a language where it is harder to test for no benefit.

-- Tolerance for the sum check. Not a business allowance — Australian 5c cash
-- rounding prints on the receipt as its own line and is captured as one, so
-- there is nothing legitimate to absorb here. This is float noise only.
create or replace function expense_lines_reconcile(p_lines jsonb, p_total numeric)
returns boolean
language sql
immutable
as $$
  select abs(
    coalesce((
      select sum((line ->> 'line_total')::numeric)
      from jsonb_array_elements(p_lines) as line
    ), 0) - p_total
  ) <= 0.01;
$$;

comment on function expense_lines_reconcile is
  'Whether a set of line items accounts for every dollar of the receipt total. '
  'The 1c tolerance is for floating-point noise, not for unexplained differences.';

-- ---------------------------------------------------------------------
-- Shared line/attachment writer
-- ---------------------------------------------------------------------

create or replace function write_expense_children(
  p_expense_id uuid,
  p_lines jsonb,
  p_attachments jsonb,
  p_uploaded_by uuid
) returns void
language plpgsql
as $$
begin
  delete from expense_line_items where expense_id = p_expense_id;

  insert into expense_line_items (
    expense_id, pricelist_item_id, description_raw, category_id, kind,
    quantity, unit_price, line_subtotal, line_gst, line_total,
    gst_applicable, normalized_quantity, normalized_unit, sort_order
  )
  select
    p_expense_id,
    nullif(line ->> 'pricelist_item_id', '')::uuid,
    line ->> 'description_raw',
    nullif(line ->> 'category_id', '')::uuid,
    coalesce(nullif(line ->> 'kind', ''), 'goods')::line_item_kind,
    (line ->> 'quantity')::numeric,
    (line ->> 'unit_price')::numeric,
    (line ->> 'line_subtotal')::numeric,
    (line ->> 'line_gst')::numeric,
    (line ->> 'line_total')::numeric,
    (line ->> 'gst_applicable')::boolean,
    (line ->> 'normalized_quantity')::numeric,
    nullif(line ->> 'normalized_unit', ''),
    coalesce((line ->> 'sort_order')::int, ordinality::int - 1)
  from jsonb_array_elements(p_lines) with ordinality as t(line, ordinality);

  -- Attachments are replaced wholesale on edit, the same as lines. The files
  -- themselves are content-addressed in storage (0028), so re-writing a row
  -- that names the same object is harmless.
  delete from expense_attachments where expense_id = p_expense_id;

  insert into expense_attachments (
    expense_id, storage_path, file_name, content_type, size_bytes, sha256,
    uploaded_by, sort_order
  )
  select
    p_expense_id,
    att ->> 'storage_path',
    att ->> 'file_name',
    coalesce(nullif(att ->> 'content_type', ''), 'application/octet-stream'),
    (att ->> 'size_bytes')::bigint,
    nullif(att ->> 'sha256', ''),
    p_uploaded_by,
    ordinality::int - 1
  from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) with ordinality as t(att, ordinality);
end;
$$;

-- ---------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------

create or replace function create_expense_with_lines(
  p_submitted_by uuid,
  p_vendor_id uuid,
  p_vendor_name_raw text,
  p_invoice_number text,
  p_receipt_date date,
  p_subtotal numeric,
  p_gst_amount numeric,
  p_total numeric,
  p_submitter_comment text,
  p_payee_id uuid,
  p_fiscal_year_hijri int,
  p_lines jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns table (id uuid, expense_number text)
language plpgsql
as $$
declare
  v_id uuid;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An expense must have at least one line item'
      using errcode = 'check_violation';
  end if;

  if not expense_lines_reconcile(p_lines, p_total) then
    raise exception 'Line items total % but the receipt total is %',
      (select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(p_lines) as line),
      p_total
      using errcode = 'check_violation';
  end if;

  insert into expenses (
    submitted_by, vendor_id, vendor_name_raw, invoice_number, receipt_date,
    subtotal, gst_amount, total, submitter_comment, payee_id,
    status, fiscal_year_hijri
  ) values (
    p_submitted_by, p_vendor_id, p_vendor_name_raw, p_invoice_number, p_receipt_date,
    p_subtotal, p_gst_amount, p_total, p_submitter_comment, p_payee_id,
    'submitted', p_fiscal_year_hijri
  )
  returning expenses.id into v_id;

  perform write_expense_children(v_id, p_lines, p_attachments, p_submitted_by);

  insert into expense_status_history (expense_id, from_status, to_status, actor_id)
  values (v_id, null, 'submitted', p_submitted_by);

  return query
    select e.id, e.expense_number from expenses e where e.id = v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Update (still-editable expenses only)
-- ---------------------------------------------------------------------

create or replace function update_expense_with_lines(
  p_expense_id uuid,
  p_actor uuid,
  p_vendor_id uuid,
  p_vendor_name_raw text,
  p_invoice_number text,
  p_receipt_date date,
  p_subtotal numeric,
  p_gst_amount numeric,
  p_total numeric,
  p_submitter_comment text,
  p_payee_id uuid,
  p_fiscal_year_hijri int,
  p_lines jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns void
language plpgsql
as $$
declare
  v_status expense_status;
  v_owner uuid;
begin
  select status, submitted_by into v_status, v_owner
  from expenses where id = p_expense_id for update;

  if v_owner is null then
    raise exception 'Expense % does not exist', p_expense_id using errcode = 'no_data_found';
  end if;

  -- Re-checked here as well as in the caller. The row is locked above, so
  -- this closes the window between an approver deciding and a submitter
  -- saving an edit they opened beforehand.
  if v_status <> 'submitted' then
    raise exception 'Expense % is % and can no longer be edited', p_expense_id, v_status
      using errcode = 'check_violation';
  end if;
  if v_owner <> p_actor then
    raise exception 'Expense % belongs to someone else', p_expense_id
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An expense must have at least one line item'
      using errcode = 'check_violation';
  end if;

  if not expense_lines_reconcile(p_lines, p_total) then
    raise exception 'Line items total % but the receipt total is %',
      (select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(p_lines) as line),
      p_total
      using errcode = 'check_violation';
  end if;

  update expenses set
    vendor_id = p_vendor_id,
    vendor_name_raw = p_vendor_name_raw,
    invoice_number = p_invoice_number,
    receipt_date = p_receipt_date,
    subtotal = p_subtotal,
    gst_amount = p_gst_amount,
    total = p_total,
    submitter_comment = p_submitter_comment,
    payee_id = p_payee_id,
    fiscal_year_hijri = p_fiscal_year_hijri,
    updated_at = now()
  where id = p_expense_id;

  perform write_expense_children(p_expense_id, p_lines, p_attachments, p_actor);
end;
$$;

-- These run through the service role only, like everything else in this app.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children, expense_lines_reconcile from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children, expense_lines_reconcile from authenticated';
  end if;
end $$;
