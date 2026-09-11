-- Which migrations this database has actually had.
--
-- Migrations are pasted into the Supabase SQL editor by hand, in filename
-- order, and until now nothing in the database said which ones had been run.
-- The only way to find out was to look for the columns a migration adds, one
-- at a time — which is what step 3 of docs/backup-and-restore.md asks of
-- whoever is restoring, at the worst possible moment.
--
-- That was tolerable with one database. The sandbox (scratchpad #1) makes it
-- two, updated on every merge, and a migration run against one and forgotten
-- on the other is exactly the mistake nobody notices until a page breaks.
--
-- So every migration from this one onwards ends by recording itself:
--
--   insert into schema_migrations (filename) values ('00NN_name.sql')
--   on conflict do nothing;
--
-- src/lib/migrations.test.ts fails CI if a migration forgets to, and the
-- System errors page and scripts/migration-status.mjs compare this table with
-- the files the code expects.

create table schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now(),

  constraint schema_migrations_filename_format check (filename ~ '^\d{4}_[a-z0-9_]+\.sql$')
);

comment on table schema_migrations is
  'One row per migration file applied to this database. Every migration from '
  '0041 records itself; 0001-0040 are backfilled by 0041.';

-- Whoever runs this has run everything before it, because the app it ships
-- with depends on all of them. For these rows applied_at is the time of the
-- backfill, not of the original run — which nothing recorded.
insert into schema_migrations (filename) values
  ('0001_init.sql'),
  ('0002_seed.sql'),
  ('0003_auth_provisioning.sql'),
  ('0004_categories.sql'),
  ('0005_vendor_details.sql'),
  ('0006_pricelist_details.sql'),
  ('0007_item_hierarchy.sql'),
  ('0008_category_hierarchy.sql'),
  ('0009_units_and_pack_sizes.sql'),
  ('0010_cost_views.sql'),
  ('0011_pricelist_column_prefs.sql'),
  ('0012_item_merge.sql'),
  ('0013_reports_query_shape.sql'),
  ('0014_pack_contents.sql'),
  ('0015_expense_number.sql'),
  ('0016_notifications.sql'),
  ('0017_email_login.sql'),
  ('0018_drop_username.sql'),
  ('0019_password_reset_attempts.sql'),
  ('0020_expense_history_index.sql'),
  ('0021_error_events.sql'),
  ('0022_dashboard_widgets.sql'),
  ('0023_vendor_item_descriptions.sql'),
  ('0024_category_item_numbers.sql'),
  ('0025_expense_submitter_note.sql'),
  ('0026_line_kinds_and_line_gst.sql'),
  ('0027_payees.sql'),
  ('0028_attachments_and_fingerprints.sql'),
  ('0029_payment_runs_and_reversals.sql'),
  ('0030_budgets.sql'),
  ('0031_atomic_expense_write.sql'),
  ('0032_signin_attempts.sql'),
  ('0033_drop_receipt_file_path.sql'),
  ('0034_vendor_identity.sql'),
  ('0035_service_lines.sql'),
  ('0036_expense_lines_view.sql'),
  ('0037_payee_account_history.sql'),
  ('0038_category_line_kinds.sql'),
  ('0039_per_category_item_numbers.sql'),
  ('0040_pack_packaging.sql'),
  ('0041_schema_migrations.sql')
on conflict do nothing;

alter table schema_migrations enable row level security;
