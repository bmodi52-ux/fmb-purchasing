-- Two GST facts the record could not hold (scratchpad #50).
--
-- 1. THE GST PRINTED ON THE RECEIPT
--
-- 0026 made GST a property of each line, and noted what that unlocked: the
-- sum of line GST can be checked against the GST printed on the receipt. The
-- submit form reads the printed figure and shows the comparison — and then the
-- figure was discarded on submit, so the person approving never saw whether
-- the two agreed. It is kept now, and a disagreement is flagged to them.
--
-- 2. CAPITAL PURCHASES
--
-- The GST return reports capital purchases (G10) apart from everything else
-- (G11). A combi oven and a box of onions were indistinguishable in the
-- ledger. A line is now marked capital or not; the app suggests it for lines
-- in a category marked as capital purchases above a threshold set in App
-- settings, and anyone who approves or pays can change it on the expense.

alter table expenses add column gst_printed numeric(12, 2);

comment on column expenses.gst_printed is
  'GST as printed on the receipt, when it printed one. Compared with gst_amount, '
  'which is the sum of line GST. Null on expenses from before 0048 and on '
  'receipts that print no GST figure.';

alter table expense_line_items add column is_capital boolean not null default false;

comment on column expense_line_items.is_capital is
  'A capital purchase — equipment rather than consumables — reported separately '
  'on the GST return (G10 rather than G11).';

alter table categories add column capital_purchases boolean not null default false;

comment on column categories.capital_purchases is
  'Lines in this category over the capital threshold (App settings) are marked '
  'capital when written. A suggestion only; the line flag is what counts.';

update categories set capital_purchases = true where name = 'Kitchen Equipment & Utensils';

-- ---------------------------------------------------------------------
-- The writers carry both
-- ---------------------------------------------------------------------
-- write_expense_children keeps its signature and reads one more key from each
-- line. The create and update functions gain p_gst_printed, which changes
-- their signatures, so the old versions are dropped first: leaving them would
-- make two overloads PostgREST cannot choose between.

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
    gst_applicable, normalized_quantity, normalized_unit, sort_order, is_capital
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
    coalesce((line ->> 'is_capital')::boolean, false)
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
  uuid, uuid, text, text, date, numeric, numeric, numeric, text, uuid, int, jsonb, jsonb
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
  p_gst_printed numeric default null
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
    status, fiscal_year_hijri, gst_printed
  ) values (
    p_submitted_by, p_vendor_id, p_vendor_name_raw, p_invoice_number, p_receipt_date,
    p_subtotal, p_gst_amount, p_total, p_submitter_comment, p_payee_id,
    'submitted', p_fiscal_year_hijri, p_gst_printed
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
  uuid, uuid, uuid, text, text, date, numeric, numeric, numeric, text, uuid, int, jsonb, jsonb
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
  p_gst_printed numeric default null
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
    gst_printed = p_gst_printed,
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

insert into schema_migrations (filename) values ('0048_gst_checks.sql')
on conflict do nothing;
