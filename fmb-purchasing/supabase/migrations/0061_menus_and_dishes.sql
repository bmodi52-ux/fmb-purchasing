-- Thaali costing, first piece (#70): a menu against a date, the dishes on it,
-- what goes into each dish, and how many thaalis are expected — which is
-- everything the cost of a day needs.
--
-- It replaces a Google Sheet with a column per thaali day: the menu at the
-- top, then Meat, Veggies and Rashan beneath it with quantities. The sheet
-- can say "Goat 120kg" but never why it is 120, so nothing in it scales when
-- the count changes and nothing can be costed without retyping prices.
--
-- Sections, procurement and release come later; this is the part everything
-- else reads from.

-- ---------------------------------------------------------------------
-- Kitchens
-- ---------------------------------------------------------------------
-- Two of them, cooking their own menus for their own numbers, so a menu day
-- belongs to one kitchen and costs are never silently added together.
create table kitchens (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into kitchens (name, sort_order) values ('Main kitchen', 10), ('Second kitchen', 20);

-- ---------------------------------------------------------------------
-- Dishes, and what goes into them
-- ---------------------------------------------------------------------
-- A dish is written once and used on any number of days, which is the whole
-- gain over the sheet: "Thaali- Bhuna gosht with roti" recurs, and a recipe
-- that recurs with it can be corrected in one place.
create table dishes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Cooks work in batches ("a pot does 200"), and the arithmetic prefers per
  -- thaali. Both are allowed, and the dish says which it is written in, so
  -- neither has to be converted by hand. A batch recipe scales in whole
  -- batches; a per-thaali one scales exactly.
  recipe_basis text not null default 'batch' check (recipe_basis in ('batch', 'thaali')),
  -- How many thaalis one batch feeds. Required for a batch recipe, meaningless
  -- for a per-thaali one.
  batch_thaalis int check (batch_thaalis is null or batch_thaalis > 0),
  notes text,
  active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  constraint dishes_batch_size_required
    check (recipe_basis <> 'batch' or batch_thaalis is not null)
);

-- Case-insensitive, so "Mug Pulao" and "mug pulao" cannot both exist.
create unique index dishes_name_key on dishes (lower(name));

create table dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references dishes (id) on delete cascade,
  -- The Pricelist item, which is what carries the price and the pack sizes.
  item_id uuid not null references items (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_id uuid not null references units (id),
  note text,
  sort_order int not null default 0
);

create index dish_ingredients_dish_idx on dish_ingredients (dish_id, sort_order);
create index dish_ingredients_item_idx on dish_ingredients (item_id);

comment on column dish_ingredients.quantity is
  'For the basis the dish states: per batch of batch_thaalis, or per thaali.';

-- ---------------------------------------------------------------------
-- The calendar
-- ---------------------------------------------------------------------
create table menu_days (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references kitchens (id),
  service_date date not null,
  -- What buying is based on. The confirmed count arrives about two days out,
  -- from the RSVP tool that is outside the site today, and is kept apart so
  -- the difference between the two is visible rather than overwritten.
  planned_thaalis int not null default 0 check (planned_thaalis >= 0),
  confirmed_thaalis int check (confirmed_thaalis is null or confirmed_thaalis >= 0),
  -- Released menus become somebody's work to procure; that is a later piece,
  -- and the status is here so the day has somewhere to say it.
  status text not null default 'draft' check (status in ('draft', 'released')),
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  unique (kitchen_id, service_date)
);

create index menu_days_date_idx on menu_days (service_date);

create table menu_day_dishes (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid not null references menu_days (id) on delete cascade,
  -- Restricted rather than cascading: a dish that has been cooked is part of
  -- the record of what was cooked, so it is retired (active = false) rather
  -- than deleted.
  dish_id uuid not null references dishes (id),
  sort_order int not null default 0,
  unique (menu_day_id, dish_id)
);

create index menu_day_dishes_dish_idx on menu_day_dishes (dish_id);

-- ---------------------------------------------------------------------
-- Who may see and plan menus
-- ---------------------------------------------------------------------
insert into app_pages (key, label, sort_order, is_permission_scope) values
  ('menus', 'Menus & dishes', 55, true)
on conflict (key) do nothing;

-- Granted to whoever administers accounts, who can then hand it on from the
-- Teams page. A new page nobody has asked for yet belongs to nobody else.
insert into team_permissions (team_id, page_key, action_key)
select distinct tp.team_id, 'menus', granted.action
from team_permissions tp
cross join (values ('view'), ('manage')) as granted (action)
where tp.page_key = 'admin_users' and tp.action_key = 'manage_users'
on conflict do nothing;

insert into schema_migrations (filename) values ('0061_menus_and_dishes.sql')
on conflict do nothing;
