-- A thaali is a set of boxes, and not everybody takes all of it (#76).
--
-- Until now a day held one number — "250 thaalis" — and every dish was
-- multiplied by it. That is not what a thaali is. It is a set of parts, each
-- taken separately: somebody takes daal and rice and skips the gosht; biryani
-- offered as 2 × 1 L is taken as one box by some and two by others; roti is on
-- some days and not others, and is taken whole or not at all.
--
-- So the count moves from the day to the line. The day's planned thaalis stay
-- — they are what a cost per thaali is divided by, and the sensible default
-- for a line nobody has thought about yet — but what gets bought comes from
-- the number against each part of the menu.

-- ---------------------------------------------------------------------
-- Roti buys as its own list
-- ---------------------------------------------------------------------
-- Bread would otherwise fall into Dry goods, and roti is somebody's own job
-- to arrange: it has a person, a baker and a delivery of its own.
alter table categories drop constraint if exists categories_menu_section_check;
alter table categories add constraint categories_menu_section_check
  check (menu_section is null or menu_section in ('meat', 'produce', 'dry', 'roti'));

alter table items drop constraint if exists items_menu_section_check;
alter table items add constraint items_menu_section_check
  check (menu_section is null or menu_section in ('meat', 'produce', 'dry', 'roti'));

alter table menu_section_owners drop constraint if exists menu_section_owners_section_check;
alter table menu_section_owners add constraint menu_section_owners_section_check
  check (section in ('meat', 'produce', 'dry', 'roti'));

alter table menu_requirements drop constraint if exists menu_requirements_section_check;
alter table menu_requirements add constraint menu_requirements_section_check
  check (section in ('meat', 'produce', 'dry', 'roti'));

-- ---------------------------------------------------------------------
-- What a dish offers, and how many take it
-- ---------------------------------------------------------------------
alter table menu_day_dishes
  add column boxes_offered numeric(6, 3) not null default 1 check (boxes_offered > 0),
  add column expected_boxes int check (expected_boxes is null or expected_boxes >= 0);

comment on column menu_day_dishes.boxes_offered is
  'How many boxes of this dish a thaali may take — 2 where people choose one box or two.';

comment on column menu_day_dishes.expected_boxes is
  'How many boxes to fill. Null means nobody has said, so the day assumes everyone takes the most it offers.';

-- ---------------------------------------------------------------------
-- The parts of a thaali that are not dishes
-- ---------------------------------------------------------------------
-- Roti and fruit have no recipe: they are bought as they are. They still have
-- to reach procurement, so each names a Pricelist item, how much of it goes in
-- a thaali, and how many people take it.
--
-- How much is the menu's decision and nobody else's: a day of half a roti is a
-- day of half a roti for everyone who takes one. Only the number of takers
-- varies.
create table menu_day_extras (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid not null references menu_days (id) on delete cascade,
  kind text not null check (kind in ('roti', 'fruit', 'other')),
  item_id uuid not null references items (id),
  -- In the item's own unit: one roti, half a roti, a piece of fruit.
  per_thaali numeric(8, 3) not null check (per_thaali > 0),
  -- Null means nobody has said, and the day's planned count is assumed.
  expected_count int check (expected_count is null or expected_count >= 0),
  note text,
  sort_order int not null default 0,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (menu_day_id, kind, item_id)
);

create index menu_day_extras_day_idx on menu_day_extras (menu_day_id, sort_order);
create index menu_day_extras_item_idx on menu_day_extras (item_id);

alter table menu_day_extras enable row level security;

insert into schema_migrations (filename) values ('0067_thaali_parts.sql')
on conflict do nothing;
