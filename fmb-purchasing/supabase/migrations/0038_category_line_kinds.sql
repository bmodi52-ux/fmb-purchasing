-- Which categories belong to which kind of line.
--
-- Every line on an expense carries a category, and the picker offers all
-- nineteen of them whatever the line is. So somebody entering a bag of rice
-- scrolls past Professional & Contractor Services, and somebody entering a
-- plumber scrolls past Dairy & Eggs — every line, every receipt. The list only
-- gets longer.
--
-- The line already knows what it is. 0026 gave it a kind, 0035 added
-- 'service', and the three groups want visibly different halves of this list:
--
--   goods    — the things a kitchen buys
--   service  — the work people are paid for
--   charge   — surcharges, delivery, discounts and rounding, which are not
--              purchases at all but still get filed somewhere
--
-- A category may serve more than one. Cleaning & Sanitation is both a shelf of
-- detergent and a contractor's invoice; Transport & Logistics is a freight
-- service and the delivery fee on somebody else's invoice.
--
-- Deliberately an ordering, not a restriction. The picker puts a line's own
-- categories first and keeps the rest under "Other categories", because a
-- category tagged wrongly here would otherwise make a legitimate expense
-- impossible to file correctly — and being unable to categorise a receipt is a
-- worse failure than scrolling past a few headings.

alter table categories add column applies_to text[] not null
  default array['goods', 'service', 'charge'];

alter table categories add constraint categories_applies_to_known
  check (applies_to <@ array['goods', 'service', 'charge']);

-- A category that applies to nothing would be invisible in every picker, which
-- is a category nobody can use rather than a category nobody has tagged.
alter table categories add constraint categories_applies_to_not_empty
  check (cardinality(applies_to) > 0);

comment on column categories.applies_to is
  'Line kinds this category is offered for first: goods, service, charge. '
  'Every category remains choosable for every kind — see 0038.';

update categories set applies_to = v.applies_to
from (
  values
    ('Groceries & Provisions',             array['goods']),
    ('Meat & Poultry',                     array['goods']),
    ('Mutton',                             array['goods']),
    ('Beef',                               array['goods']),
    ('Chicken',                            array['goods']),
    ('Lamb',                               array['goods']),
    ('Produce (Fruit & Vegetables)',       array['goods']),
    ('Dairy & Eggs',                       array['goods']),
    ('Bakery',                             array['goods']),
    ('Beverages',                          array['goods']),
    ('Nuts & Dryfoods',                    array['goods']),
    ('Disposables & Packaging',            array['goods']),
    ('Kitchen Equipment & Utensils',       array['goods']),
    ('Gas & Fuel',                         array['goods']),
    -- Both: a shelf of product and somebody's invoice for doing the work.
    ('Cleaning & Sanitation',              array['goods', 'service']),
    ('Stationery & Printing',              array['goods', 'service']),
    ('Events & Venue',                     array['goods', 'service']),
    -- Work, and the fees that ride along on other people's invoices.
    ('Maintenance & Repairs',              array['service']),
    ('Professional & Contractor Services', array['service']),
    ('Transport & Logistics',              array['service', 'charge']),
    ('Miscellaneous',                      array['goods', 'service', 'charge'])
) as v(name, applies_to)
where categories.name = v.name;
