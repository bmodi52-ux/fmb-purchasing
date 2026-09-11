-- Organisation-wide settings an admin can change without a deploy.
--
-- The first is whether approvers and payers are warned about possible
-- duplicate submissions (scratchpad #21), which was asked for with the
-- expectation that it might be switched off again after seeing how it goes.
-- Reminders, price-alert limits and batch-payment bank details follow, so this
-- is one small key/value table rather than a column per setting.
--
-- The app owns the shape of each value (src/lib/app-settings.ts), including a
-- default for every key, so a missing row means "the default" and nothing has
-- to be seeded for a setting to work.

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_]*$')
);

comment on table app_settings is
  'Admin-editable settings. Keys and their defaults are defined in '
  'src/lib/app-settings.ts; a missing row means the default applies.';

alter table app_settings enable row level security;

insert into schema_migrations (filename) values ('0046_app_settings.sql')
on conflict do nothing;
