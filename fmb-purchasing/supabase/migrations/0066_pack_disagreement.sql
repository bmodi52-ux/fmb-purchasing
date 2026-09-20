-- A price is only as good as the pack behind it (#71).
--
-- Ginger read $100.00/kg on a receipt that says "Ginger Box 2x10kg, $200" —
-- ten dollars a kilo. The line was matched to an offer whose pack is a single
-- loose unit, so two of them is 2 kg rather than 20, and the division came out
-- ten times too high. That figure then planned a menu at $625 for ginger the
-- receipt covered for $62.50.
--
-- The arithmetic was right; the pack was wrong. Nothing here tries to guess
-- which of the two numbers to believe — when the receipt's own reading and the
-- pack's maths are an order of magnitude apart, neither can be stated as a
-- price. So the line is kept, and marked, and left out of what the app calls
-- the cost of that item until somebody fixes the pack.

-- The definition as 0044 left it — goods lines only, and neither declined nor
-- withdrawn — with the two columns and the judgement below added. Restated in
-- full because create or replace cannot add a column any other way.
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
  ips.sold_loose,
  -- What the receipt itself appeared to say, kept beside what the pack makes
  -- of it. Only comparable when the reading is in the same unit the item is
  -- costed in; anything else is no evidence either way.
  eli.normalized_quantity as receipt_quantity,
  eli.normalized_unit     as receipt_unit,
  case
    when eli.normalized_quantity is null or eli.normalized_quantity <= 0 then false
    when eli.normalized_unit is distinct from iu.base_unit_code then false
    when eli.quantity * ips.total_quantity * iu.to_base_factor <= 0 then false
    else
      eli.normalized_quantity / (eli.quantity * ips.total_quantity * iu.to_base_factor) >= 5
      or eli.normalized_quantity / (eli.quantity * ips.total_quantity * iu.to_base_factor) <= 0.2
  end               as pack_disagrees
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

-- The aggregate is what the rest of the app means by "what this costs", so a
-- line nobody can price is left out of it entirely. An item whose every
-- purchase is in dispute therefore has no row here — the same as an item
-- nobody has bought, which is the honest answer.
create or replace view item_unit_costs
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
  max(receipt_date)                           as latest_receipt_date,
  bool_and(contents_confirmed)                as all_contents_confirmed
from item_paid_unit_costs
where not pack_disagrees
group by item_id, base_unit_code;

insert into schema_migrations (filename) values ('0066_pack_disagreement.sql')
on conflict do nothing;
