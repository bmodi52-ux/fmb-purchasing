-- Canonical definitions of "what does this cost per unit", so the Pricelist,
-- Reports, and the future Thaali cost calculator all agree rather than each
-- re-deriving it.
--
-- Two different questions, two views:
--
--   offer_unit_costs   — what a vendor is *quoting*, per base unit. Lets a
--                        1 L x 10 offer be compared against a 2 L x 6 offer.
--   item_unit_costs    — what we have *actually paid*, per base unit, latest
--                        and averaged across vendors. This is the number to
--                        cost a recipe with: it reflects real invoices rather
--                        than aspirational pricelist entries.
--
-- item_paid_unit_costs is the per-purchase detail behind the summary, exposed
-- separately so a caller can window it (e.g. cost a Thaali using only prices
-- as at that date, or average the last N purchases) instead of being stuck
-- with the all-time figures.
--
-- security_invoker = on matters: without it a view runs with its owner's
-- rights and would hand the anon key data that the default-deny RLS on the
-- underlying tables is there to withhold (see the note atop 0001).

-- ---------------------------------------------------------------------
-- Quoted cost per base unit, per vendor offer
-- ---------------------------------------------------------------------

create view offer_unit_costs
with (security_invoker = on) as
select
  o.id            as offer_id,
  o.vendor_id,
  o.status,
  o.pack_price,
  ips.id          as pack_size_id,
  ips.item_id,
  ips.inner_quantity,
  ips.pack_count,
  ips.total_quantity,
  ips.label       as pack_label,
  iu.code         as inner_unit_code,
  iu.dimension,
  iu.base_unit_code,
  ips.total_quantity * iu.to_base_factor as total_base_quantity,
  case
    when o.pack_price is not null and ips.total_quantity > 0
      then round(o.pack_price / (ips.total_quantity * iu.to_base_factor), 4)
  end             as cost_per_base_unit
from pricelist_items o
join item_pack_sizes ips on ips.id = o.pack_size_id
join units iu on iu.id = ips.inner_unit_id;

-- ---------------------------------------------------------------------
-- Actually-paid cost per base unit, one row per purchased line
-- ---------------------------------------------------------------------

create view item_paid_unit_costs
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
  round(eli.line_total / (eli.normalized_quantity * nu.to_base_factor), 4) as cost_per_base_unit
from expense_line_items eli
join expenses e on e.id = eli.expense_id
join pricelist_items o on o.id = eli.pricelist_item_id
join item_pack_sizes ips on ips.id = o.pack_size_id
-- normalized_unit is free text from receipt extraction; rows whose unit we
-- can't resolve are excluded rather than silently mis-costed
join units nu on lower(nu.code) = lower(eli.normalized_unit)
where eli.normalized_quantity is not null
  and eli.normalized_quantity > 0
  and eli.line_total is not null
  and e.status <> 'declined';

-- ---------------------------------------------------------------------
-- Latest and average paid cost per base unit, per item
-- ---------------------------------------------------------------------

create view item_unit_costs
with (security_invoker = on) as
select
  item_id,
  base_unit_code,
  count(*)                                    as purchase_count,
  count(distinct vendor_id)                   as vendor_count,
  round(avg(cost_per_base_unit), 4)           as avg_cost_per_base_unit,
  min(cost_per_base_unit)                     as min_cost_per_base_unit,
  max(cost_per_base_unit)                     as max_cost_per_base_unit,
  (array_agg(cost_per_base_unit
     order by receipt_date desc nulls last, submitted_at desc))[1] as latest_cost_per_base_unit,
  max(receipt_date)                           as latest_receipt_date
from item_paid_unit_costs
group by item_id, base_unit_code;

-- Belt-and-braces alongside security_invoker: the app only ever reads these
-- through the service role, so the browser-facing roles need no access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on offer_unit_costs, item_paid_unit_costs, item_unit_costs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on offer_unit_costs, item_paid_unit_costs, item_unit_costs from authenticated';
  end if;
end $$;
