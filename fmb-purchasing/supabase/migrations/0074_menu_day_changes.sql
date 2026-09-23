-- A record of changes to a day's menu (#15).
--
-- Once a day is released its lists are somebody's work, and a dish taken off
-- or a count changed after that is something the person buying needs to be
-- able to find out about: who did it, and when. Items and vendors already
-- keep a history; menus did not.
--
-- Every change is recorded, and whether the day was released at the time,
-- so the page can say which came after the lists went out. The kitchen and
-- date are kept on the row itself, so deleting a day's menu (#21) leaves its
-- history, and the deletion, behind.

create table menu_day_changes (
  id uuid primary key default gen_random_uuid(),
  menu_day_id uuid references menu_days (id) on delete set null,
  kitchen_id uuid not null references kitchens (id),
  service_date date not null,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now(),
  was_released boolean not null default false,
  action text not null,
  detail text
);

create index menu_day_changes_day_idx on menu_day_changes (kitchen_id, service_date, changed_at desc);

alter table menu_day_changes enable row level security;

insert into schema_migrations (filename) values ('0074_menu_day_changes.sql')
on conflict do nothing;
