-- One-off cleanup: clear operational data, keep people.
--
-- NOT a migration. Lives outside supabase/migrations/ on purpose — it must
-- never be replayed as part of bootstrapping a fresh database.
--
-- Kept: profiles, teams, team_members, app_pages, app_actions,
--       team_permissions (identity and access), plus categories and units
--       (reference lists — the app is unusable without them and re-seeding
--       is avoidable work).
--
-- Cleared: every expense and its trail, all vendor/pricelist master data,
--          and per-user UI state (column preferences, dashboard widgets).
--          Everyone keeps their login and lands on default views.
--
-- Receipt files in the `receipts` storage bucket are NOT touched by this
-- script — storage is not in the database. Run scripts/cleanup-data.mjs
-- to empty the bucket, or every uploaded receipt is left orphaned.

begin;

-- A single statement, naming every table explicitly, with no CASCADE.
--
-- The omission is deliberate: if any table referencing one of these is
-- missing from the list, Postgres refuses the whole statement instead of
-- silently truncating it too. Verified complete as of migration 0023 —
-- everything with a foreign key into vendors, expenses, items,
-- pricelist_items or item_pack_sizes appears below.
--
-- RESTART IDENTITY rewinds items.item_seq, vendors.vendor_seq and
-- expenses.expense_seq, so numbering starts again at 0001 rather than
-- continuing from wherever the test data left off.
truncate table
  -- expenses and their audit trail
  expense_status_history,
  expense_line_items,
  expenses,
  notifications,
  error_events,
  -- pricelist master data, leaf tables first for readability
  vendor_item_descriptions,
  item_duplicate_dismissals,
  item_history,
  pricelist_item_history,
  pricelist_items,
  item_pack_sizes,
  items,
  -- vendor master data
  vendor_contacts,
  vendor_collection_addresses,
  vendors,
  -- per-user UI state (the accounts themselves are untouched)
  user_column_preferences,
  user_dashboard_widgets,
  -- password-reset throttle counters; independent of the above, cleared
  -- only so stale hour-old limits do not follow anyone into the reset
  password_reset_attempts
restart identity;

-- Once 0024 lands, add item_number_aliases to the list above.

-- Sanity check before committing. Every count must be 0, and the three
-- kept tables must still hold rows.
select 'expenses' as t, count(*) from expenses
union all select 'items', count(*) from items
union all select 'vendors', count(*) from vendors
union all select 'pricelist_items', count(*) from pricelist_items
union all select 'profiles (kept)', count(*) from profiles
union all select 'teams (kept)', count(*) from teams
union all select 'categories (kept)', count(*) from categories
union all select 'units (kept)', count(*) from units;

-- Review the output, then:
commit;
-- or, if anything looks wrong:
-- rollback;
