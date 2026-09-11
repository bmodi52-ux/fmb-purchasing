-- Withdrawing a submission — see 0043.
--
-- A withdrawn expense is not spend. It is excluded everywhere a declined one
-- is: per-unit costs, reports, budgets, duplicate warnings. It stays on the
-- submitter's own list and on its detail page, with its history and files.

create or replace function withdraw_expenses(
  p_expense_ids uuid[],
  p_actor uuid
) returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  -- Only the submitter's own, and only while nobody has decided them — the
  -- same rule deletion had. Anything else in the list is skipped, not refused,
  -- so a bulk selection that includes an approved expense still withdraws the
  -- rest.
  with withdrawn as (
    update expenses e
    set status = 'withdrawn', updated_at = now()
    where e.id = any (p_expense_ids)
      and e.submitted_by = p_actor
      and e.status = 'submitted'
    returning e.id
  ),
  recorded as (
    insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment)
    select w.id, 'submitted', 'withdrawn', p_actor, 'Withdrawn by the submitter'
    from withdrawn w
    returning 1
  )
  select count(*) into v_count from recorded;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Withdrawn expenses are not purchases
-- ---------------------------------------------------------------------
-- The definition as 0026 left it, with the status filter widened. Restated in
-- full because create or replace cannot change a WHERE clause alone; the
-- column list is unchanged, so item_unit_costs is undisturbed.
create or replace view item_paid_unit_costs
with (security_invoker = on) as
select
  ips.item_id,
  eli.id            as line_item_id,
  eli.expense_id,
  e.vendor_id,
  e.receipt_date,
  e.created_at      as submitted_at,
  e.status          as expense_status,
  eli.line_total,
  eli.quantity      as normalized_quantity,
  iu.base_unit_code,
  eli.quantity * ips.total_quantity * iu.to_base_factor as base_quantity,
  round(
    eli.line_total / (eli.quantity * ips.total_quantity * iu.to_base_factor),
    4
  )                 as cost_per_base_unit,
  i.name            as item_name,
  ips.contents_confirmed,
  ips.sold_loose
from expense_line_items eli
join expenses e on e.id = eli.expense_id
join pricelist_items o on o.id = eli.pricelist_item_id
join item_pack_sizes ips on ips.id = o.pack_size_id
join items i on i.id = ips.item_id
join units iu on iu.id = ips.inner_unit_id
where eli.kind = 'goods'
  and eli.quantity is not null
  and eli.quantity > 0
  and ips.total_quantity > 0
  and eli.line_total is not null
  and e.status not in ('declined', 'withdrawn');

-- The duplicate-invoice lookup (0028) skips declined expenses; it skips
-- withdrawn ones for the same reason — resubmitting something you took back
-- is not a double claim.
drop index if exists expenses_vendor_invoice_idx;
create index expenses_vendor_invoice_idx
  on expenses (vendor_id, lower(invoice_number))
  where invoice_number is not null and status not in ('declined', 'withdrawn');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function withdraw_expenses from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function withdraw_expenses from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0044_withdraw_expenses.sql')
on conflict do nothing;
