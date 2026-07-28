-- Reports issued seven database queries one after another. Because Vercel
-- runs this app's functions in Washington D.C. while the database is in
-- Sydney, every one of those costs a full trans-Pacific round trip, so the
-- page spent well over a second just waiting.
--
-- Most of the queries were independent and can simply run in parallel (done
-- in the page itself). Two of them can be removed outright, which is what
-- this migration is for — a query you never send is faster than one you
-- parallelise.

-- 1. item_paid_unit_costs already joins through to the item; exposing its
--    name saves Reports a follow-up "now fetch the names for these ids"
--    round trip. Appended at the end so the dependent item_unit_costs view
--    keeps working.
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
  eli.normalized_quantity,
  nu.base_unit_code,
  eli.normalized_quantity * nu.to_base_factor as base_quantity,
  round(eli.line_total / (eli.normalized_quantity * nu.to_base_factor), 4) as cost_per_base_unit,
  i.name            as item_name
from expense_line_items eli
join expenses e on e.id = eli.expense_id
join pricelist_items o on o.id = eli.pricelist_item_id
join item_pack_sizes ips on ips.id = o.pack_size_id
join items i on i.id = ips.item_id
join units nu on lower(nu.code) = lower(eli.normalized_unit)
where eli.normalized_quantity is not null
  and eli.normalized_quantity > 0
  and eli.line_total is not null
  and e.status <> 'declined';

-- 2. The fiscal-year picker was built by selecting fiscal_year_hijri for
--    *every expense ever* and de-duplicating in JavaScript — fine at 1 row,
--    wasteful at 10,000. Let Postgres do the distinct.
create or replace view expense_fiscal_years
with (security_invoker = on) as
select distinct fiscal_year_hijri from expenses;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on expense_fiscal_years from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on expense_fiscal_years from authenticated';
  end if;
end $$;
