-- A receipt that doesn't match the claim is flagged, not blocked (#51).
--
-- A Fresh Poultry invoice for $990 had a $150 "Clean and cut" charge added
-- that isn't on it. The form would not submit until the receipt total was
-- typed up to $1,140 — at which point it said everything on the receipt was
-- accounted for, which was untrue, and the approver never saw the gap.
--
-- Two totals are now kept apart:
--
--   expenses.total          what is claimed: the sum of every line, as before
--                           (expense_lines_reconcile still holds it to that)
--   expenses.receipt_total  what the receipt says
--
-- A line can be marked as not on the receipt, with a note saying why. What
-- the receipt total and the lines that are on it still disagree by is the
-- unexplained difference, shown to the approver rather than refused.
--
-- The scanned total is kept too, and changing it needs a reason, so a total
-- typed up to make the sums work is visible as exactly that.

alter table expenses add column receipt_total numeric(12, 2);
alter table expenses add column receipt_total_scanned numeric(12, 2);
alter table expenses add column receipt_total_note text;

comment on column expenses.receipt_total is
  'The total printed on the receipt, as entered. Null on expenses from before 0060, '
  'when the lines had to add up to it and it was therefore the same as total.';
comment on column expenses.receipt_total_scanned is
  'The receipt total as the scan read it, when the receipt was scanned.';
comment on column expenses.receipt_total_note is
  'Why the receipt total was changed from what the scan read.';

alter table expense_line_items add column not_on_receipt boolean not null default false;
alter table expense_line_items add column not_on_receipt_note text;

comment on column expense_line_items.not_on_receipt is
  'Claimed, but not on the attached receipt — a charge added by hand, say. Left out '
  'when the lines are compared with the receipt total, and shown to the approver.';

-- ---------------------------------------------------------------------
-- The writers carry them
-- ---------------------------------------------------------------------
-- write_expense_children keeps its signature and reads two more keys from each
-- line. create and update gain three parameters, which changes their
-- signatures, so the 0048 versions are dropped first: leaving them would make
-- two overloads PostgREST cannot choose between.

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
    gst_applicable, normalized_quantity, normalized_unit, sort_order, is_capital,
    not_on_receipt, not_on_receipt_note
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
    coalesce((line ->> 'sort_order')::int, ordinality::int - 1),
    coalesce((line ->> 'is_capital')::boolean, false),
    coalesce((line ->> 'not_on_receipt')::boolean, false),
    nullif(line ->> 'not_on_receipt_note', '')
  from jsonb_array_elements(p_lines) with ordinality as t(line, ordinality);

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

drop function if exists create_expense_with_lines(
  uuid, uuid, text, text, date, numeric, numeric, numeric, text, uuid, int, jsonb, jsonb, numeric
);

create function create_expense_with_lines(
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
  p_attachments jsonb default '[]'::jsonb,
  p_gst_printed numeric default null,
  p_receipt_total numeric default null,
  p_receipt_total_scanned numeric default null,
  p_receipt_total_note text default null
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
    raise exception 'Line items total % but the expense total is %',
      (select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(p_lines) as line),
      p_total
      using errcode = 'check_violation';
  end if;

  insert into expenses (
    submitted_by, vendor_id, vendor_name_raw, invoice_number, receipt_date,
    subtotal, gst_amount, total, submitter_comment, payee_id,
    status, fiscal_year_hijri, gst_printed,
    receipt_total, receipt_total_scanned, receipt_total_note
  ) values (
    p_submitted_by, p_vendor_id, p_vendor_name_raw, p_invoice_number, p_receipt_date,
    p_subtotal, p_gst_amount, p_total, p_submitter_comment, p_payee_id,
    'submitted', p_fiscal_year_hijri, p_gst_printed,
    p_receipt_total, p_receipt_total_scanned, nullif(p_receipt_total_note, '')
  )
  returning expenses.id into v_id;

  perform write_expense_children(v_id, p_lines, p_attachments, p_submitted_by);

  insert into expense_status_history (expense_id, from_status, to_status, actor_id)
  values (v_id, null, 'submitted', p_submitted_by);

  return query
    select e.id, e.expense_number from expenses e where e.id = v_id;
end;
$$;

drop function if exists update_expense_with_lines(
  uuid, uuid, uuid, text, text, date, numeric, numeric, numeric, text, uuid, int, jsonb, jsonb, numeric
);

create function update_expense_with_lines(
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
  p_attachments jsonb default '[]'::jsonb,
  p_gst_printed numeric default null,
  p_receipt_total numeric default null,
  p_receipt_total_scanned numeric default null,
  p_receipt_total_note text default null
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
    raise exception 'Line items total % but the expense total is %',
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
    gst_printed = p_gst_printed,
    receipt_total = p_receipt_total,
    receipt_total_scanned = p_receipt_total_scanned,
    receipt_total_note = nullif(p_receipt_total_note, ''),
    updated_at = now()
  where id = p_expense_id;

  perform write_expense_children(p_expense_id, p_lines, p_attachments, p_actor);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0060_receipt_total_and_off_receipt_lines.sql')
on conflict do nothing;
