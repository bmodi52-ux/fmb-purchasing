-- Budget versus actual (spec §10), which nothing in the schema has touched
-- until now.
--
-- Deliberately the smallest thing that answers the question people actually
-- ask — "are we over on meat this year?" — rather than a general planning
-- module. One amount, per category, per fiscal year. No monthly phasing, no
-- per-vendor allocations, no draft/approved lifecycle: those are all
-- plausible, none of them have been asked for, and each would need its own
-- UI to be worth the row it sits in.
--
-- The fiscal year is the Hijri one the rest of the app uses (Shawwal through
-- Ramadan — see src/lib/fiscal-year.ts), stored the same
-- way expenses store it: as the integer year its Shawwal falls in.
--
-- Budgets are set against *leaf* categories only. A parent category's budget
-- is the sum of its children, computed rather than stored, so a parent and
-- its children can never disagree about what was budgeted.

create table category_budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete cascade,
  fiscal_year_hijri int not null,

  -- GST-inclusive, matching how expense totals are recorded and how anyone
  -- setting a budget thinks about the number.
  amount numeric(12, 2) not null,

  note text,
  set_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint category_budgets_amount_positive check (amount >= 0),
  constraint category_budgets_unique unique (category_id, fiscal_year_hijri)
);

create index category_budgets_year_idx on category_budgets (fiscal_year_hijri);

comment on table category_budgets is
  'One budgeted amount per leaf category per Hijri fiscal year, GST-inclusive. '
  'A parent category''s budget is the sum of its children and is never stored.';

comment on column category_budgets.fiscal_year_hijri is
  'The Hijri year the fiscal year''s 1 Shawwal falls in — same convention as '
  'expenses.fiscal_year_hijri.';

alter table category_budgets enable row level security;
