-- 0086 — an offer's price is dated by the day its receipt counts on, in
-- Sydney (reports audit, following 0083).
--
-- 0083 stored the day each expense counts on, expenses.report_date: its
-- receipt date, or the day it was submitted in Sydney when the receipt had
-- none. Pricing still worked that day out again as
-- coalesce(receipt_date, created_at::date), and created_at::date is the day in
-- UTC. From midnight until 10 or 11 in the morning in Sydney that is the day
-- before. So an undated receipt submitted at 8:30 on 1 July dated its offer's
-- price 30 June, named itself "receipt … of 30/06/2026" in the offer's
-- history, and was skipped as older than a price a receipt of 1 July had set.
--
--   price_offers_from_expense — as 0082, reading e.report_date. The check
--     against the offer's current price date reads that date in Sydney too:
--     a price typed at 8:30 on 1 July is stamped 30 June in UTC, and a
--     receipt of 30 June then replaced it as if it were newer. A price from a
--     receipt is stamped midnight UTC, which is the same day in Sydney, so
--     that comparison is unchanged.
--   item_paid_unit_costs — as 0066, with report_date added at the end, so
--     the price alerts and the Pricelist's cheapest recent source date a
--     purchase the way Reports does.
--   A one-off repair: offers already priced from an undated receipt and dated
--     the UTC day take the Sydney day (none on live when this was written).
--
-- 0078 and 0082 also worked the day out in one-off updates. Those have run,
-- and the repair covers what they left. The undo bookkeeping in each offer's
-- history keeps the date it recorded.

-- ---------------------------------------------------------------------
-- Take an expense's prices onto its offers. As 0082, dated by report_date.
-- ---------------------------------------------------------------------
create or replace function price_offers_from_expense(p_expense_id uuid)
returns int
language plpgsql
as $$
declare
  r record;
  v_price numeric(12, 4);
  v_count int := 0;
  v_undo jsonb;
begin
  for r in
    select distinct on (l.pricelist_item_id)
      l.id as line_id, l.pricelist_item_id as offer_id, l.line_total, l.quantity,
      e.report_date as day, e.expense_number,
      o.pack_price, o.price_set_at, o.price_source_line_id
    from expense_line_items l
    join expenses e on e.id = l.expense_id
    join pricelist_items o on o.id = l.pricelist_item_id
    join item_paid_unit_costs p on p.line_item_id = l.id
    where l.expense_id = p_expense_id
      and l.kind = 'goods'
      and not l.not_on_receipt
      and l.line_total > 0
      and l.quantity > 0
      and not p.pack_disagrees
      and e.status not in ('declined', 'withdrawn')
      and o.status <> 'rejected'
    order by l.pricelist_item_id, l.sort_order
  loop
    -- An older receipt is on record as a purchase, but isn't today's price.
    continue when r.price_set_at is not null
      and r.day < (r.price_set_at at time zone 'Australia/Sydney')::date;
    continue when r.price_source_line_id = r.line_id;

    v_price := round(r.line_total / r.quantity, 4);
    update pricelist_items
    set pack_price = v_price, price_set_at = r.day::timestamptz, price_source_line_id = r.line_id
    where id = r.offer_id;

    v_undo := jsonb_build_object('_restore', jsonb_build_object(
      'line_id', r.line_id,
      'previous_price_set_at', r.price_set_at,
      'previous_source_line_id', r.price_source_line_id));

    -- A price that moved shows in the history; the same price seen again
    -- writes only its undo, which the item page doesn't show.
    if r.pack_price is distinct from v_price then
      v_undo := v_undo || jsonb_build_object(
        'pack_price', jsonb_build_object('old', r.pack_price, 'new', v_price),
        'price_source', jsonb_build_object('old', null,
          'new', 'receipt ' || coalesce(r.expense_number, '') || ' of ' || to_char(r.day, 'DD/MM/YYYY')));
    end if;
    insert into pricelist_item_history (item_id, changes) values (r.offer_id, v_undo);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- The definition as 0066 left it, with report_date added. Restated in full
-- because create or replace can only add a column at the end.
-- ---------------------------------------------------------------------
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
  end               as pack_disagrees,
  -- The day the purchase counts on (0083), rather than working it out again
  -- from submitted_at, which is in UTC.
  e.report_date
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

-- ---------------------------------------------------------------------
-- Offers priced from an undated receipt were dated its day in UTC. A price
-- from a receipt is always dated that receipt's day, so the Sydney one
-- replaces it. The price and its source stay, and pricelist_items_date_price
-- leaves an update that doesn't touch the price alone.
-- ---------------------------------------------------------------------
update pricelist_items o
set price_set_at = e.report_date::timestamptz
from expense_line_items l
join expenses e on e.id = l.expense_id
where l.id = o.price_source_line_id
  and e.receipt_date is null
  and o.price_set_at is distinct from e.report_date::timestamptz;

insert into schema_migrations (filename) values ('0086_price_report_date.sql')
on conflict do nothing;
