-- Makes per-unit cost genuinely comparable across vendors and pack sizes,
-- which is the whole point of the Pricelist and the prerequisite for costing
-- Thaalis from ingredient quantities later.
--
-- Three problems this fixes:
--
-- 1. Units had no dimension or conversion factor, so a 500 g pack and a 1 kg
--    pack produced per-unit costs of "0.01/g" and "9/kg" that nothing could
--    compare. Units now know their dimension and their factor to a base unit
--    (g -> kg, mL -> L), so every cost can be expressed per base unit.
--
-- 2. Pack size was a single number, so "1 L x 10 carton" and "2 L x 6 carton"
--    could not both be represented, let alone compared (10 L vs 12 L). Pack
--    size is now inner quantity x pack count, with the total generated.
--
-- 3. items.name was globally unique, which defeated the category hierarchy
--    added in 0008: different meats have different cuts, but the moment a
--    second animal needed a similarly-named cut the insert was rejected.
--    Names are now unique per category.
--
-- Also drops the stored per_unit_cost columns. They were computed at write
-- time from unit_price / pack_size, but pack size lives on a different table,
-- so editing a pack size silently left every existing offer's per-unit cost
-- wrong. Cost is now derived on read by the offer_unit_costs view (0010).

-- ---------------------------------------------------------------------
-- 1. Units know their dimension and how to reach a base unit
-- ---------------------------------------------------------------------

alter table units add column dimension text not null default 'count';
alter table units add constraint units_dimension_check
  check (dimension in ('mass', 'volume', 'count', 'length'));

-- Multiply a quantity in this unit by to_base_factor to get base_unit_code.
alter table units add column to_base_factor numeric(20, 9) not null default 1;
alter table units add constraint units_to_base_factor_positive check (to_base_factor > 0);
alter table units add column base_unit_code text;

update units set dimension = 'mass',   to_base_factor = 1,     base_unit_code = 'kg' where code = 'kg';
update units set dimension = 'mass',   to_base_factor = 0.001, base_unit_code = 'kg' where code = 'g';
update units set dimension = 'volume', to_base_factor = 1,     base_unit_code = 'L'  where code = 'L';
update units set dimension = 'volume', to_base_factor = 0.001, base_unit_code = 'L'  where code = 'mL';

-- Countable units all reduce to "each". 'carton' and 'unit' are retained
-- rather than merged into 'ea' so existing rows keep their labels; with a
-- shared base unit they now compare correctly regardless.
update units set dimension = 'count', to_base_factor = 1, base_unit_code = 'ea'
where code in ('ea', 'carton', 'unit');

-- anything added since (none expected) falls back to counting itself
update units set base_unit_code = code where base_unit_code is null;

alter table units alter column base_unit_code set not null;
alter table units add constraint units_base_unit_fk foreign key (base_unit_code) references units (code);

-- ---------------------------------------------------------------------
-- 2. Pack size = inner quantity x pack count
-- ---------------------------------------------------------------------

alter table item_pack_sizes rename column pack_size to inner_quantity;
alter table item_pack_sizes rename column pack_size_unit_id to inner_unit_id;

alter table item_pack_sizes add column pack_count int not null default 1;
alter table item_pack_sizes add constraint item_pack_sizes_pack_count_positive check (pack_count > 0);
alter table item_pack_sizes add constraint item_pack_sizes_inner_quantity_positive check (inner_quantity > 0);

-- Total in inner_unit terms. Converting to the base unit needs units.to_base_factor,
-- which a generated column can't reach across tables — see offer_unit_costs (0010).
alter table item_pack_sizes
  add column total_quantity numeric(16, 3) generated always as (inner_quantity * pack_count) stored;

-- Two pack sizes with identical numbers but different labels are legitimately
-- different products ("Loose, per kg" vs "1 kg vacuum pack"), so label is part
-- of the key. NULLS NOT DISTINCT still blocks true duplicates.
alter table item_pack_sizes drop constraint item_pack_sizes_item_id_pack_size_pack_size_unit_id_key;
alter table item_pack_sizes add constraint item_pack_sizes_shape_key
  unique nulls not distinct (item_id, inner_quantity, inner_unit_id, pack_count, label);

-- ---------------------------------------------------------------------
-- 3. Item names are unique per category, not globally
-- ---------------------------------------------------------------------

-- constraint name predates the canonical_item_groups -> items rename in 0007
alter table items drop constraint canonical_item_groups_name_key;
alter table items add constraint items_category_name_key
  unique nulls not distinct (category_id, name);

-- ---------------------------------------------------------------------
-- 4. Offers: one honest price field, the vendor's own code, no stored cost
-- ---------------------------------------------------------------------

-- unit_price was always the price of one whole pack, not a price per unit —
-- the name invited entering a per-kg figure for an 80 kg pack.
alter table pricelist_items rename column unit_price to pack_price;

-- unit_price_unit_id was decorative (the real unit comes from the pack size),
-- and per_unit_cost/per_unit_cost_unit_id are now derived on read.
alter table pricelist_items drop column unit_price_unit_id;
alter table pricelist_items drop column per_unit_cost;
alter table pricelist_items drop column per_unit_cost_unit_id;

-- The vendor's own product code off their invoice — a far more reliable
-- matching key for future receipts than fuzzy description text.
alter table pricelist_items add column vendor_sku text;
create index pricelist_items_vendor_sku_idx
  on pricelist_items (vendor_id, vendor_sku) where vendor_sku is not null;
