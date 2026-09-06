-- One-off cleanup: clear operational data, keep people.
--
-- Supersedes 2026-09-05_reset-operational-data.sql, which is now incomplete:
-- it was "verified complete as of migration 0023", and 0026-0032 added six
-- tables that reference the ones it truncates. Because that script names every
-- table explicitly and uses no CASCADE, it would refuse to run rather than
-- silently leave rows behind — which is the behaviour its author intended, and
-- the reason this file exists instead of a surprise.
--
-- New since 0023, and why each belongs here:
--   expense_attachments   references expenses
--   payees                referenced BY expenses.payee_id and payment_runs
--   payment_runs          references payees; referenced by expenses
--   category_budgets      references categories (which are kept)
--   extraction_attempts   per-user throttle counters
--   signin_attempts       per-address throttle counters
--
-- NOT a migration. Lives outside supabase/migrations/ on purpose — it must
-- never be replayed as part of bootstrapping a fresh database.
--
-- Kept: profiles, teams, team_members, app_pages, app_actions,
--       team_permissions (identity and access), plus categories and units
--       (reference lists — the app is unusable without them and re-seeding
--       is avoidable work).
--
-- Receipt files in the `receipts` storage bucket are NOT touched by this
-- script — storage is not in the database. Run scripts/cleanup-data.mjs
-- to empty the bucket, or every uploaded receipt is left orphaned.
--
-- AFTERWARDS: open Admin -> System errors and press "Refresh Reports data".
-- Reports serves a cached copy of the ledger that only in-app writes
-- invalidate, so until then it keeps showing the figures from before this ran
-- — for up to an hour, with nothing on screen to say the numbers are old
-- rather than wrong.

begin;

-- A single statement, naming every table explicitly, with no CASCADE.
--
-- The omission is deliberate: if any table referencing one of these is
-- missing from the list, Postgres refuses the whole statement instead of
-- silently truncating it too. Verified complete as of migration 0032.
--
-- RESTART IDENTITY rewinds items.item_seq, vendors.vendor_seq,
-- expenses.expense_seq and payment_run_seq, so numbering starts again at
-- 0001 rather than continuing from wherever the test data left off. That is
-- the whole reason this is a truncate and not a delete.
truncate table
  -- expenses and their audit trail
  expense_status_history,
  expense_attachments,
  expense_line_items,
  expenses,
  notifications,
  error_events,
  -- who gets paid, and the transfers that paid them
  payment_runs,
  payees,
  -- budgets are per fiscal year and per category; the categories stay
  category_budgets,
  -- pricelist master data, leaf tables first for readability
  vendor_item_descriptions,
  item_duplicate_dismissals,
  item_history,
  item_number_aliases,
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
  -- throttle counters; independent of the above, cleared only so stale
  -- hour-old limits do not follow anyone into the reset
  password_reset_attempts,
  extraction_attempts,
  signin_attempts
restart identity;

-- Sanity check before committing. Every count must be 0, and the kept tables
-- must still hold rows.
select 'expenses' as t, count(*) from expenses
union all select 'expense_attachments', count(*) from expense_attachments
union all select 'payees', count(*) from payees
union all select 'payment_runs', count(*) from payment_runs
union all select 'category_budgets', count(*) from category_budgets
union all select 'items', count(*) from items
union all select 'vendors', count(*) from vendors
union all select 'pricelist_items', count(*) from pricelist_items
union all select 'notifications', count(*) from notifications
union all select 'profiles (kept)', count(*) from profiles
union all select 'teams (kept)', count(*) from teams
union all select 'team_permissions (kept)', count(*) from team_permissions
union all select 'categories (kept)', count(*) from categories
union all select 'units (kept)', count(*) from units;

-- Review the output, then:
commit;
-- or, if anything looks wrong:
-- rollback;
