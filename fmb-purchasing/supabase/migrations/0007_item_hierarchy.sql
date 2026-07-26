-- Restructures Pricelist into a 3-level hierarchy per user request:
--   Item (canonical product, e.g. "Chicken Breast", canonical unit kg)
--     -> Pack size (e.g. "Loose / per kg", "Carton of 100 kg")
--       -> Vendor offer (today's pricelist_items row: vendor, brand, price,
--          change history) — comparable across pack sizes/vendors via
--          per_unit_cost, always expressed in the item's canonical unit.
--
-- canonical_item_groups already had the right shape for "Item" (name +
-- canonical_unit) — it's promoted here rather than replaced. pricelist_items
-- keeps its name (expense_line_items.pricelist_item_id already points at it)
-- but is repurposed to be the vendor-offer level: item identity, category,
-- and pack size move up to their own tables.

-- ---------------------------------------------------------------------
-- 1. Promote canonical_item_groups -> items
-- ---------------------------------------------------------------------

insert into units (code, label, sort_order)
select distinct cig.canonical_unit, cig.canonical_unit, 100
from canonical_item_groups cig
where cig.canonical_unit is not null
  and not exists (select 1 from units u where u.code = cig.canonical_unit);

alter table canonical_item_groups rename to items;

alter table items add column canonical_unit_id uuid references units (id);
update items i set canonical_unit_id = u.id from units u where u.code = i.canonical_unit;
alter table items alter column canonical_unit_id set not null;
alter table items drop column canonical_unit;

alter table items add column item_seq int generated always as identity;
alter table items add column item_number text generated always as ('I-' || lpad(item_seq::text, 4, '0')) stored;
alter table items add constraint items_item_number_key unique (item_number);

alter table items add column category_id uuid references categories (id);
alter table items add column status entry_status not null default 'approved';
alter table items add column created_by uuid references profiles (id);
alter table items add column reviewed_by uuid references profiles (id);
alter table items add column reviewed_at timestamptz;
alter table items add column comments text;
alter table items add column updated_at timestamptz not null default now();
alter table items add column updated_by uuid references profiles (id);

create index items_status_idx on items (status);

-- best-effort backfill: give each item the category of any existing offer
-- that was already linked to it (category previously lived per-vendor-row)
update items i
set category_id = sub.category_id
from (
  select distinct on (canonical_item_group_id) canonical_item_group_id, category_id
  from pricelist_items
  where canonical_item_group_id is not null and category_id is not null
  order by canonical_item_group_id, created_at
) sub
where sub.canonical_item_group_id = i.id;

-- ---------------------------------------------------------------------
-- 2. New pack-size level
-- ---------------------------------------------------------------------

create table item_pack_sizes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  pack_size numeric(12, 3) not null,
  pack_size_unit_id uuid not null references units (id),
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  unique (item_id, pack_size, pack_size_unit_id)
);

create index item_pack_sizes_item_idx on item_pack_sizes (item_id);
alter table item_pack_sizes enable row level security;

-- backfill a pack size for every existing offer (pack_size 1 x canonical
-- unit when the offer didn't already specify one)
insert into item_pack_sizes (item_id, pack_size, pack_size_unit_id)
select distinct pi.canonical_item_group_id,
  coalesce(pi.pack_size, 1),
  coalesce(pi.pack_size_unit_id, i.canonical_unit_id)
from pricelist_items pi
join items i on i.id = pi.canonical_item_group_id
where pi.canonical_item_group_id is not null
on conflict (item_id, pack_size, pack_size_unit_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Repurpose pricelist_items as the vendor-offer level
-- ---------------------------------------------------------------------

alter table pricelist_items add column pack_size_id uuid references item_pack_sizes (id);

update pricelist_items pi
set pack_size_id = ips.id
from item_pack_sizes ips
join items i on i.id = ips.item_id
where ips.item_id = pi.canonical_item_group_id
  and ips.pack_size = coalesce(pi.pack_size, 1)
  and ips.pack_size_unit_id = coalesce(pi.pack_size_unit_id, i.canonical_unit_id);

alter table pricelist_items alter column pack_size_id set not null;

alter table pricelist_items drop constraint if exists pricelist_items_item_number_key;
alter table pricelist_items drop column item_number;
alter table pricelist_items drop column item_seq;
alter table pricelist_items drop column description;
alter table pricelist_items drop column category_id;
alter table pricelist_items drop column canonical_item_group_id;
alter table pricelist_items drop column pack_size;
alter table pricelist_items drop column pack_size_unit_id;

create index pricelist_items_pack_size_idx on pricelist_items (pack_size_id);

-- ---------------------------------------------------------------------
-- 4. Item-level change history (mirrors pricelist_item_history)
-- ---------------------------------------------------------------------

create table item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now(),
  changes jsonb not null default '{}'::jsonb
);

create index item_history_item_idx on item_history (item_id);
alter table item_history enable row level security;
