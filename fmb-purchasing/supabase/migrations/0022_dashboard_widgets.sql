-- Lets a user pin their own selection of Reports charts/tables, each with its
-- own filters, to their home page.
--
-- One row per widget rather than one JSONB blob per user (as
-- user_column_preferences does): a dashboard is an ordered list of
-- independent things, each added/edited/removed/reordered on its own, not a
-- single all-or-nothing preference document.

create table user_dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- which chart/table shape to render — see WidgetKind in dashboard-widgets.ts
  kind text not null,
  title text not null,
  -- fiscal year/month/vendor/category/item filters plus kind-specific fields
  -- (dimension, compareBy, itemId), mirroring aggregate.ts's Filters shape
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The dashboard reads "this user's widgets, in order" on every home page load.
create index user_dashboard_widgets_user_order_idx on user_dashboard_widgets (user_id, sort_order);

alter table user_dashboard_widgets enable row level security;
