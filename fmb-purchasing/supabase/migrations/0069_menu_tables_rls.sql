-- Row-level security on the menu tables that were created without it (#18).
--
-- 0001 turned RLS on for every table that existed then, and each migration
-- since has turned it on for the tables it adds. 0061, 0063 and 0064 did not,
-- and Supabase's security advisor flagged it on both projects: with RLS off,
-- the anon key that every browser is given can read, change and delete these
-- rows straight through the API, without signing in.
--
-- No policies are added, the same as every other table. The app reads and
-- writes through the service role, which RLS does not apply to, so nothing in
-- the app changes; only the anon and authenticated roles lose direct access.

alter table kitchens enable row level security;
alter table dishes enable row level security;
alter table dish_ingredients enable row level security;
alter table menu_days enable row level security;
alter table menu_day_dishes enable row level security;
alter table menu_section_owners enable row level security;
alter table menu_requirements enable row level security;
alter table expense_line_allocations enable row level security;
alter table box_sizes enable row level security;

insert into schema_migrations (filename) values ('0069_menu_tables_rls.sql')
on conflict do nothing;
