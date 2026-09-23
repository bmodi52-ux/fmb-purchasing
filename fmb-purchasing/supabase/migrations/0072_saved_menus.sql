-- Estimates, saved menus and favourites (#17), and one menu on many days (#20).
--
-- A menu used to exist only on a day. To ask "what would this cost for 250?"
-- somebody had to put it on a date first, and to reuse one they had to find
-- the day it was last cooked. A saved menu is the same contents — dishes,
-- roti and fruit, or a typed list — held apart from any day, with a thaali
-- count to cost it at.
--
-- An estimate is a saved menu nobody has named yet (`saved` false). Naming it
-- keeps it; unnamed ones are cleared after a week, so trying things out does
-- not leave a pile behind. Putting a menu on days copies it: changing the
-- saved menu later does not reach back into days already planned from it,
-- which may have been bought for.

create table saved_menus (
  id uuid primary key default gen_random_uuid(),
  name text,
  saved boolean not null default false,
  favourite boolean not null default false,
  -- The count the estimate is worked out for, and the count a day starts
  -- with when the menu is put on it and the day has none of its own.
  thaalis int not null default 0 check (thaalis >= 0),
  menu_text text,
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  check (not saved or (name is not null and length(trim(name)) > 0))
);

create index saved_menus_saved_idx on saved_menus (saved, favourite desc, name);

create table saved_menu_dishes (
  id uuid primary key default gen_random_uuid(),
  saved_menu_id uuid not null references saved_menus (id) on delete cascade,
  dish_id uuid not null references dishes (id),
  boxes_offered numeric(6, 3) not null default 1 check (boxes_offered > 0),
  expected_boxes int check (expected_boxes is null or expected_boxes >= 0),
  sort_order int not null default 0,
  unique (saved_menu_id, dish_id)
);

create index saved_menu_dishes_dish_idx on saved_menu_dishes (dish_id);

create table saved_menu_extras (
  id uuid primary key default gen_random_uuid(),
  saved_menu_id uuid not null references saved_menus (id) on delete cascade,
  kind text not null check (kind in ('roti', 'fruit', 'other')),
  item_id uuid not null references items (id),
  per_thaali numeric(8, 3) not null check (per_thaali > 0),
  expected_count int check (expected_count is null or expected_count >= 0),
  sort_order int not null default 0,
  unique (saved_menu_id, kind, item_id)
);

create index saved_menu_extras_item_idx on saved_menu_extras (item_id);

create table saved_menu_lines (
  id uuid primary key default gen_random_uuid(),
  saved_menu_id uuid not null references saved_menus (id) on delete cascade,
  item_id uuid not null references items (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_id uuid not null references units (id),
  section text check (section is null or section in ('meat', 'produce', 'dry', 'roti')),
  sort_order int not null default 0,
  unique (saved_menu_id, item_id)
);

create index saved_menu_lines_item_idx on saved_menu_lines (item_id);

alter table saved_menus enable row level security;
alter table saved_menu_dishes enable row level security;
alter table saved_menu_extras enable row level security;
alter table saved_menu_lines enable row level security;

insert into schema_migrations (filename) values ('0072_saved_menus.sql')
on conflict do nothing;
