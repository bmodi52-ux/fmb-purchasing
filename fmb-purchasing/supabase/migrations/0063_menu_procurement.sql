-- Thaali costing, the rest of it (#70): sections that can be corrected, a
-- released menu that becomes somebody's work, and receipts tied back to the
-- day they were bought for.
--
-- 0061 and 0062 got as far as knowing what a day needs. This is what happens
-- next: the requirement is frozen when the menu is released, assigned to
-- whoever buys that section, marked ordered and then delivered, and finally
-- matched against the expense lines that paid for it — which is what makes
-- "planned against actual" a fact rather than an estimate.

-- ---------------------------------------------------------------------
-- Which list a thing belongs on
-- ---------------------------------------------------------------------
-- Meat and Fresh produce are fixed; Dry goods is everything else, and is the
-- one that will want amending. Rather than a setting listing categories, the
-- section is recorded where the exception belongs: on the category, or on the
-- one item that is an exception to its category. Null means "work it out from
-- the category name", which is what happens today.
alter table categories add column menu_section text
  check (menu_section is null or menu_section in ('meat', 'produce', 'dry'));
alter table items add column menu_section text
  check (menu_section is null or menu_section in ('meat', 'produce', 'dry'));

comment on column categories.menu_section is
  'Which procurement list this category''s items belong on, when the name alone gets it wrong.';
comment on column items.menu_section is
  'An item that belongs on a different list from the rest of its category.';

-- ---------------------------------------------------------------------
-- Who buys what
-- ---------------------------------------------------------------------
create table menu_section_owners (
  id uuid primary key default gen_random_uuid(),
  -- Null means "both kitchens", which is the usual arrangement: one person
  -- buys the meat for everywhere.
  kitchen_id uuid references kitchens (id) on delete cascade,
  section text not null check (section in ('meat', 'produce', 'dry')),
  owner_id uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create unique index menu_section_owners_unique_idx
  on menu_section_owners (coalesce(kitchen_id, '00000000-0000-0000-0000-000000000000'::uuid), section);

-- ---------------------------------------------------------------------
-- What a released day needs
-- ---------------------------------------------------------------------
-- Frozen at release, not derived on read: the prices behind it move, the
-- recipes get corrected, and a day that has been bought for should still say
-- what it was bought against. Re-releasing recomputes it.
create table menu_requirements (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid not null references menu_days (id) on delete cascade,
  item_id uuid not null references items (id),
  section text not null check (section in ('meat', 'produce', 'dry')),
  -- In the item's base unit, as the recipes add up to.
  quantity numeric(12, 3) not null check (quantity > 0),
  base_unit_code text not null,
  -- What it was expected to cost, and where that price came from.
  price_per_unit numeric(12, 4),
  price_basis text,
  planned_cost numeric(12, 2),
  -- Who is buying it, and where it is up to.
  owner_id uuid references profiles (id),
  vendor_id uuid references vendors (id),
  status text not null default 'to_order' check (status in ('to_order', 'ordered', 'delivered', 'cancelled')),
  ordered_at timestamptz,
  ordered_by uuid references profiles (id),
  delivered_at timestamptz,
  delivered_by uuid references profiles (id),
  note text,
  created_at timestamptz not null default now(),
  unique (menu_day_id, item_id)
);

create index menu_requirements_owner_idx on menu_requirements (owner_id, status);
create index menu_requirements_item_idx on menu_requirements (item_id);

alter table menu_days add column released_at timestamptz;
alter table menu_days add column released_by uuid references profiles (id);

-- ---------------------------------------------------------------------
-- What was actually bought against it
-- ---------------------------------------------------------------------
-- A receipt belongs to no day; its lines belong to requirements. One line can
-- feed several days, and one day is fed by many lines, so the allocation is a
-- record of its own — correctable, auditable, and what planned-against-actual
-- reads.
create table expense_line_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_line_item_id uuid not null references expense_line_items (id) on delete cascade,
  menu_requirement_id uuid not null references menu_requirements (id) on delete cascade,
  -- In the requirement's base unit.
  quantity numeric(12, 3) not null check (quantity > 0),
  amount numeric(12, 2) not null,
  -- Whether the app proposed this or a person said so.
  source text not null default 'matched' check (source in ('matched', 'chosen')),
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  unique (expense_line_item_id, menu_requirement_id)
);

create index expense_line_allocations_requirement_idx on expense_line_allocations (menu_requirement_id);

-- ---------------------------------------------------------------------
-- Who may do the buying
-- ---------------------------------------------------------------------
insert into app_pages (key, label, sort_order, is_permission_scope) values
  ('procurement', 'Procurement', 56, true)
on conflict (key) do nothing;

-- Whoever plans menus can already see what the days need, so procurement
-- comes with it; handing it on is done from the Teams page.
insert into team_permissions (team_id, page_key, action_key)
select distinct tp.team_id, 'procurement', granted.action
from team_permissions tp
cross join (values ('view'), ('manage')) as granted (action)
where tp.page_key = 'menus' and tp.action_key = 'manage'
on conflict do nothing;

insert into schema_migrations (filename) values ('0063_menu_procurement.sql')
on conflict do nothing;
