-- Per-unit cost was being computed from the wrong denominator.
--
-- A receipt line reads "Eggs, qty 12, $60 each, $720 total". That 12 is
-- twelve *packs*, and each pack holds ~30 eggs — a fact that appears nowhere
-- on the receipt. Dividing $720 by 12 reports "$60.00/ea", which reads as
-- $60 per egg. Out by a factor of thirty.
--
-- The pack contents can only come from a human, but not from the person
-- submitting the expense — they upload, glance, and submit. It comes from
-- whoever reviews the Pricelist, once per vendor+item, at which point every
-- future receipt for that item costs out correctly with no further input.
--
-- So: record whether a pack's contents have actually been confirmed, and
-- compute cost from (line quantity x pack contents) rather than from the
-- quantity the AI happened to read.

-- ---------------------------------------------------------------------
-- 1. Pack size gains two facts about itself
-- ---------------------------------------------------------------------

-- False for the "1 x unit" placeholder created when a receipt mentions an
-- item we've never seen. Weight and volume are auto-confirmed below: "80 kg"
-- is already in base units, so there is nothing for a human to tell us.
alter table item_pack_sizes
  add column if not exists contents_confirmed boolean not null default false;

-- Distinguishes buying loose by the kilo from a genuine 1 kg pack. Both are
-- "1 kg x 1", so without this they are indistinguishable, and a loose item
-- reads as though it were a one-kilo bag.
alter table item_pack_sizes
  add column if not exists sold_loose boolean not null default false;

-- Anything already in the table was either entered by a human or measures a
-- weight/volume, both of which are trustworthy.
update item_pack_sizes ips
set contents_confirmed = true
where exists (
  select 1 from units u
  where u.id = ips.inner_unit_id and u.dimension in ('mass', 'volume')
);

-- ---------------------------------------------------------------------
-- 2. Cost per base unit derives from the pack, not from the OCR reading
-- ---------------------------------------------------------------------
--
-- Two changes here beyond the denominator:
--
--   * units is joined through the pack size rather than by string-matching
--     expense_line_items.normalized_unit. That match was an inner join, so
--     any line whose unit text wasn't in the units picklist ("packs",
--     "dozen") vanished from per-unit reporting entirely and silently.
--
--   * contents_confirmed is exposed so callers can present unconfirmed
--     figures as provisional instead of stating them as fact.
--
-- normalized_quantity/normalized_unit are left on the line item as a record
-- of what the receipt appeared to say; they are simply no longer load-bearing.

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
where eli.quantity is not null
  and eli.quantity > 0
  and ips.total_quantity > 0
  and eli.line_total is not null
  and e.status <> 'declined';

-- item_unit_costs sits on top of the above; surface how much of what it
-- aggregates rests on unconfirmed pack contents so the UI can say so.
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
group by item_id, base_unit_code;
