-- A monthly count of high-value stock (#10).
--
-- Meat, rice, oil and ghee are bought in bulk and sit in the store between
-- thaali days, and what is there is worth knowing: what it is worth, and
-- whether it is going down the way the menus say it should. Nothing else in
-- the app counts what is on the shelf; everything is treated as bought for
-- the day (#15). This is a record kept alongside, and changes no list.
--
-- Which items are counted is a short list somebody keeps; each count is one
-- quantity per item per date, in whatever unit it was counted in.

create table stock_count_items (
  item_id uuid primary key references items (id) on delete cascade,
  sort_order int not null default 0,
  added_by uuid references profiles (id),
  added_at timestamptz not null default now()
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  counted_on date not null,
  item_id uuid not null references items (id) on delete cascade,
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit_id uuid not null references units (id),
  note text,
  counted_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (counted_on, item_id)
);

create index stock_counts_item_idx on stock_counts (item_id, counted_on desc);

alter table stock_count_items enable row level security;
alter table stock_counts enable row level security;

insert into schema_migrations (filename) values ('0075_stock_counts.sql')
on conflict do nothing;
