-- Price alerts, preferred vendors, unusual spend and saved report views
-- (scratchpad #29, #41, #42).

-- ---------------------------------------------------------------------
-- Price alert limits
-- ---------------------------------------------------------------------
-- The Pricelist-wide limits live in app_settings ('price_alerts'). A category
-- or an item may set its own, as percentages; null means "use the level
-- above". Rises and falls are separate — a price falling is usually good news,
-- so it is often allowed further.

alter table categories
  add column price_rise_percent numeric(6, 2) check (price_rise_percent is null or price_rise_percent > 0),
  add column price_fall_percent numeric(6, 2) check (price_fall_percent is null or price_fall_percent > 0);

alter table items
  add column price_rise_percent numeric(6, 2) check (price_rise_percent is null or price_rise_percent > 0),
  add column price_fall_percent numeric(6, 2) check (price_fall_percent is null or price_fall_percent > 0),
  -- What a purchase is expected to cost per base unit (kg, L, each). Either
  -- end may be left open.
  add column expected_min_per_unit numeric(12, 4) check (expected_min_per_unit is null or expected_min_per_unit >= 0),
  add column expected_max_per_unit numeric(12, 4) check (expected_max_per_unit is null or expected_max_per_unit >= 0),
  add column preferred_vendor_id uuid references vendors (id) on delete set null,
  add constraint items_expected_range_order check (
    expected_min_per_unit is null or expected_max_per_unit is null or expected_min_per_unit <= expected_max_per_unit
  );

-- The built-in price and spend alerts are sent once per expense line and kind
-- (or once per expense for spend), however often the expense is resubmitted.
create table price_alert_firings (
  fired_key text primary key,
  fired_at timestamptz not null default now()
);

-- Alert rules can now be built on price changes and unusual spend.
alter table alert_rules drop constraint alert_rules_event_check;
alter table alert_rules add constraint alert_rules_event_check check (event in (
  'expense_submitted', 'expense_approved', 'expense_paid', 'vendor_added', 'budget_threshold',
  'price_change', 'unusual_spend'
));

-- ---------------------------------------------------------------------
-- Saved report views
-- ---------------------------------------------------------------------
-- A named set of report filters. Its owner keeps it to themselves, shares it
-- with everyone who can see Reports, or with chosen teams. Only the owner
-- changes or deletes it; anyone it is shared with may open or copy it.

create table saved_report_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  -- The report query: { period, section, vendors, categories, items, breakdownBy, compareBy }
  query jsonb not null,
  shared_with text not null default 'private' check (shared_with in ('private', 'reports', 'teams')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_report_views_owner_idx on saved_report_views (owner_id);

create table saved_report_view_teams (
  view_id uuid not null references saved_report_views (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  primary key (view_id, team_id)
);

alter table price_alert_firings enable row level security;
alter table saved_report_views enable row level security;
alter table saved_report_view_teams enable row level security;

insert into schema_migrations (filename) values ('0053_price_alerts_and_saved_views.sql')
on conflict do nothing;
