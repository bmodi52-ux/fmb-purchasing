-- Two rules about money that the app previously worked around rather than
-- modelled. Both change what a line item *is*, so they land together.
--
-- 1. THE RECEIPT TOTAL IS AUTHORITATIVE, AND EVERY DOLLAR OF IT SITS ON A LINE
--
-- The submit form used to compute the expense total as the sum of its line
-- items, which meant anything the receipt charged but did not itemise was
-- silently discarded: an Aldi credit-card surcharge of $0.56, a Radhe 10%
-- discount of -$9.20, freight, container deposits, cash rounding. The
-- recorded total then disagreed with the tax invoice, the bank transfer, and
-- the BAS — and the submitter was reimbursed short by exactly the surcharge.
--
-- The naive fix (stop computing the total) would have broken something else.
-- reports/aggregate.ts aggregates at line level and states, correctly, that
-- lines "sum exactly to the expense total, so line totals are a faithful
-- decomposition rather than an approximation". That invariant was true only
-- because the form forced it. Dropping the forcing without replacing it would
-- have left every report quietly under-counting by the charges it never saw.
--
-- So the invariant is kept and the total is captured: the gap is closed by
-- adding the missing line, not by rewriting the total. `kind` is what makes
-- that possible — a charge is a real line, categorised and visible, instead
-- of being smeared across the grocery lines or lost.
--
-- 2. GST IS A PROPERTY OF THE LINE, NOT A SHARE OF THE TOTAL
--
-- Receipt extraction has always inferred gstApplicable per line, and the
-- write path has always thrown it away, replacing it with
-- `line_total / total * gst_amount`. On a receipt that mixes GST-free food
-- with a taxable surcharge — which in this kitchen is most of them — that
-- attributes GST to fresh meat and produce that carry none.
--
-- These receipts state it per line and always have: Foodworks prints
-- "(*) denotes items which attract GST", Aldi flags taxable lines with "A",
-- Campbells has a GST AMT column. Storing the flag lets line GST be computed
-- from it, and unlocks a reconciliation that was previously impossible:
-- sum(line_gst) can now be checked against the GST amount printed on the
-- receipt. Under apportionment that check was circular — line GST was
-- *defined* as a share of the receipt total, so it always agreed with itself
-- no matter how wrong it was.

create type line_item_kind as enum (
  'goods',       -- something bought; the only kind that carries a unit cost
  'surcharge',   -- card surcharge, service fee
  'delivery',    -- freight, delivery, fuel levy
  'discount',    -- always negative
  'rounding',    -- Australian 5c cash rounding, either sign
  'deposit',     -- container/crate deposit, and its refund as a negative
  'unallocated'  -- see below
);

alter table expense_line_items
  add column kind line_item_kind not null default 'goods';

comment on column expense_line_items.kind is
  'What this line represents. Only ''goods'' lines carry a per-unit cost and '
  'belong in price analytics; the rest exist so that the line items add up to '
  'the total printed on the receipt.';

comment on type line_item_kind is
  '''unallocated'' is the escape hatch for a receipt that cannot be itemised — '
  'torn, illegible, a total with no breakdown. It keeps both invariants true '
  '(the total is right, and the lines sum to it) while marking the ambiguity '
  'explicitly, so the remainder surfaces for a person to resolve instead of '
  'being hidden inside a guessed line.';

-- Deliberately nullable. Rows written before this migration had no per-line
-- flag — their line_gst was apportioned from the receipt total — and there is
-- no honest way to infer one after the fact. Null means "this row predates
-- per-line GST"; every row written from here on sets it.
alter table expense_line_items
  add column gst_applicable boolean;

comment on column expense_line_items.gst_applicable is
  'Whether GST applies to this line, read from the receipt. Null on rows '
  'written before migration 0026, whose line_gst was apportioned from the '
  'receipt total rather than derived per line.';

-- Sign rules, as far as they can be stated without over-constraining. A
-- discount is never positive and goods are never negative -- except that a
-- credit line on a wholesale invoice is genuinely negative goods (Campbells
-- invoice 17113 carries -$23.03 and -$92.12), so goods are left unconstrained
-- on purpose. Rounding and deposits legitimately go either way.
alter table expense_line_items
  add constraint expense_line_items_discount_sign
  check (kind <> 'discount' or line_total <= 0);

-- Charges have no pack to cost against, so they must never reach the
-- per-unit analytics. In practice a surcharge line carries no quantity and
-- resolves to no pricelist item, so the existing joins and the `quantity > 0`
-- filter already drop it; the filter is restated against `kind` so that a
-- charge line which somehow acquires both cannot land in a $/kg trend.
--
-- Everything else below is the definition as 0014 left it, reproduced
-- verbatim: `create or replace` cannot add a WHERE clause without restating
-- the whole body, and the column list is unchanged so the dependent
-- item_unit_costs view is undisturbed.
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
  and e.status <> 'declined';

-- Reporting cuts by kind (charges excluded from spend-by-item, included in
-- spend-by-vendor), and the reconciliation check reads every line of one
-- expense at once. Both are covered by the existing expense_id index plus
-- this one for the kind filter.
create index expense_line_items_kind_idx on expense_line_items (kind)
  where kind <> 'goods';
