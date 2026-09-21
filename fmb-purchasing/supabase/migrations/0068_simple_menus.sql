-- A day planned the way the sheet plans it (#77).
--
-- The costed way — dishes, recipes, box sizes, counts per line — is more than
-- the team may be ready for, and the app should not be the thing holding up
-- the move off the Google Sheet. So a day can also be set up plainly: the
-- menu typed as text, and under it the meat, the fresh produce and the dry
-- goods listed with their quantities, exactly as the sheet holds them.
--
-- What matters is that nothing after it changes. A typed quantity is the same
-- requirement as a calculated one, so release, the section lists, who buys
-- what, ordered and delivered, and the receipts allocated back all run off a
-- simple day exactly as they run off a costed one. What a simple day gives up
-- is only the part that was derived: a cost per thaali worked out from
-- recipes, and quantities that move when the count does.

-- The menu as somebody would write it on the sheet: "Bhuna gosht, rotli,
-- kheer". No dish, no recipe, nothing to look up.
alter table menu_days add column menu_text text;

comment on column menu_days.menu_text is
  'The menu as plain text, for days planned the simple way (#77). Dishes are used instead when the day has them.';

-- What to buy, typed straight in. The item is still a Pricelist item, because
-- that is what carries a price and a pack size and what a receipt matches
-- against; what is not said is which dish it was for.
create table menu_day_lines (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid not null references menu_days (id) on delete cascade,
  item_id uuid not null references items (id),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_id uuid not null references units (id),
  -- Left null, the item's own category decides, the same as everywhere else.
  -- Set, it is because somebody put the line under a different heading.
  section text check (section is null or section in ('meat', 'produce', 'dry', 'roti')),
  note text,
  sort_order int not null default 0,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (menu_day_id, item_id)
);

create index menu_day_lines_day_idx on menu_day_lines (menu_day_id, sort_order);
create index menu_day_lines_item_idx on menu_day_lines (item_id);

alter table menu_day_lines enable row level security;

insert into schema_migrations (filename) values ('0068_simple_menus.sql')
on conflict do nothing;
