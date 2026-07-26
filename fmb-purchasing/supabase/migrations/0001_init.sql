-- FMB Purchasing — initial schema
-- Auth: Supabase Auth (auth.users). This app is accessed exclusively through
-- Next.js server actions/route handlers using the service role key, so
-- authorization is enforced in application code against team_permissions,
-- not via per-table RLS policies keyed to dynamic permission rows. RLS is
-- still enabled with a default-deny policy on every table so the anon/public
-- key (if ever exposed) cannot read or write anything directly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. People, teams, configurable permissions
-- ---------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text not null,
  -- real contact address for notifications (§7); the auth identity itself
  -- (auth.users.email) is a synthetic address derived from username, since
  -- login is by username/password, not email — see src/lib/auth.
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- every new user is auto-enrolled in the default ("Member") team
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index one_default_team on teams (is_default) where is_default;

create table team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Registry of pages/sections. Rows are seeded by the app, not end users, so
-- new pages can be introduced by shipping a migration rather than editing code.
create table app_pages (
  key text primary key,
  label text not null,
  sort_order int not null default 0
);

-- Registry of actions a team can be granted on a page.
create table app_actions (
  key text primary key,
  label text not null
);

create table team_permissions (
  team_id uuid not null references teams (id) on delete cascade,
  page_key text not null references app_pages (key) on delete cascade,
  action_key text not null references app_actions (key) on delete cascade,
  primary key (team_id, page_key, action_key)
);

-- ---------------------------------------------------------------------
-- 2. Master data: categories, vendors, pricelist, canonical groups
-- ---------------------------------------------------------------------

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);

create type entry_status as enum ('pending', 'approved', 'rejected');

create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  abn text,
  status entry_status not null default 'pending',
  created_by uuid references profiles (id),
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index vendors_status_idx on vendors (status);

-- Rolls up the same underlying product across vendors/spelling variants,
-- for analytics only (see §9). Independent of vendor-scoped item matching.
create table canonical_item_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  canonical_unit text not null, -- e.g. 'kg', 'L'
  created_at timestamptz not null default now()
);

-- Vendor-scoped pricelist. The same product from two vendors is two rows here
-- by design (§3.1.2) — canonical_item_group_id is what ties them together
-- for reporting.
create table pricelist_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors (id) on delete cascade,
  description text not null,
  category_id uuid references categories (id),
  canonical_item_group_id uuid references canonical_item_groups (id),
  status entry_status not null default 'pending',
  created_by uuid references profiles (id),
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vendor_id, description)
);

create index pricelist_items_vendor_idx on pricelist_items (vendor_id);
create index pricelist_items_status_idx on pricelist_items (status);

-- ---------------------------------------------------------------------
-- 3. Expenses (one row per receipt/submission)
-- ---------------------------------------------------------------------

create type expense_status as enum (
  'submitted', 'approved', 'declined', 'paid'
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references profiles (id),
  vendor_id uuid references vendors (id),
  vendor_name_raw text, -- fallback if extraction/manual entry has no vendor match yet
  invoice_number text,
  receipt_date date,
  receipt_file_path text, -- storage path; null when submitted without a receipt
  subtotal numeric(12, 2) not null default 0,
  gst_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  status expense_status not null default 'submitted',
  -- fiscal year per §8 (Shawwal -> Sha'ban, Fatimi/Misri Hijri calendar),
  -- computed in application code at write time via src/lib/hijri and stored
  -- for fast filtering — Postgres has no native Hijri conversion.
  fiscal_year_hijri int not null,
  decision_comment text,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  payment_reference text,
  payment_date date,
  paid_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_status_idx on expenses (status);
create index expenses_submitted_by_idx on expenses (submitted_by);
create index expenses_fiscal_year_idx on expenses (fiscal_year_hijri);

create table expense_line_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses (id) on delete cascade,
  pricelist_item_id uuid references pricelist_items (id),
  description_raw text not null,
  category_id uuid references categories (id),
  quantity numeric(12, 3),
  unit_price numeric(12, 4),
  line_subtotal numeric(12, 2) not null default 0,
  line_gst numeric(12, 2) not null default 0,
  line_total numeric(12, 2) not null default 0,
  -- per-unit normalization (§3.1.5), inferred automatically at extraction
  normalized_quantity numeric(12, 3),
  normalized_unit text, -- e.g. 'kg', 'L'
  sort_order int not null default 0
);

create index expense_line_items_expense_idx on expense_line_items (expense_id);
create index expense_line_items_pricelist_item_idx on expense_line_items (pricelist_item_id);

-- Full audit trail of status transitions. Also the seam for a future
-- multi-approver/threshold model (§5, §14): additional steps become
-- additional rows rather than a schema change.
create table expense_status_history (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses (id) on delete cascade,
  from_status expense_status,
  to_status expense_status not null,
  actor_id uuid references profiles (id),
  comment text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Per-user UI preferences
-- ---------------------------------------------------------------------

create table user_column_preferences (
  user_id uuid not null references profiles (id) on delete cascade,
  page_key text not null references app_pages (key) on delete cascade,
  visible_columns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, page_key)
);

-- ---------------------------------------------------------------------
-- 5. Default-deny RLS on every table (see note at top of file)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
