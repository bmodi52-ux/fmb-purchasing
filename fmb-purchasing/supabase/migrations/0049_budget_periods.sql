-- Budgets for any period, in any calendar (scratchpad #22).
--
-- 0030 stored one budget per category per Hijri fiscal year. Budgets can now
-- be set for a Hijri year, an Australian financial year, a calendar year, a
-- quarter, a month or any range — and they carry across: a financial year's
-- budget is made of whatever budgets cover its days. The rule for overlapping
-- budgets, and for overriding when their totals cannot both hold, lives in
-- src/lib/budget-allocation.ts; the table only has to hold the facts.
--
-- So a budget becomes a date range with an amount, the calendar it was set in
-- (for its label and for "copy from last year"), and a priority that says
-- which of two overlapping budgets keeps the days they share.

-- ---------------------------------------------------------------------
-- Hijri dates in SQL, to move the existing rows
-- ---------------------------------------------------------------------
-- The same Fatimi/Misri tabular calendar as src/lib/hijri/hijri.ts: 30-year
-- cycles of 354-day years with a leap day in eleven of them, counted from the
-- same epoch. to_date(..., 'J') reads a Julian day number, which is what the
-- TypeScript computes. budget-periods.test.ts checks the two agree.

create or replace function hijri_to_gregorian(p_year int, p_month int, p_day int)
returns date
language plpgsql
immutable
as $$
declare
  v_cycles int := (p_year - 1) / 30;
  v_position int := p_year - v_cycles * 30;
  v_days int := v_cycles * 10631;
  v_leap int[] := array[2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29];
  k int;
begin
  for k in 1 .. v_position - 1 loop
    v_days := v_days + 354 + (case when k = any (v_leap) then 1 else 0 end);
  end loop;
  -- Months alternate 30 and 29 days from Muharram; Zilhijja gains the leap day,
  -- but it is never before another month, so it never counts here.
  for k in 1 .. p_month - 1 loop
    v_days := v_days + (case when k % 2 = 1 then 30 else 29 end);
  end loop;
  return to_date((1948439 + v_days + p_day - 1)::text, 'J');
end;
$$;

comment on function hijri_to_gregorian is
  'Misri tabular Hijri date to Gregorian, matching hijriToGregorian in src/lib/hijri/hijri.ts.';

-- ---------------------------------------------------------------------
-- Budgets become ranges
-- ---------------------------------------------------------------------

alter table category_budgets add column start_date date;
alter table category_budgets add column end_date date;
alter table category_budgets add column period_code text;
alter table category_budgets add column label text;
alter table category_budgets add column priority int not null default 0;

update category_budgets set
  start_date = hijri_to_gregorian(fiscal_year_hijri, 10, 1),
  end_date = hijri_to_gregorian(fiscal_year_hijri + 1, 10, 1) - 1,
  period_code = 'h' || fiscal_year_hijri,
  label = fiscal_year_hijri || '-' || lpad(((fiscal_year_hijri + 1) % 100)::text, 2, '0') || ' H';

alter table category_budgets alter column start_date set not null;
alter table category_budgets alter column end_date set not null;
alter table category_budgets alter column period_code set not null;
alter table category_budgets alter column label set not null;

alter table category_budgets add constraint category_budgets_range_order check (start_date <= end_date);

-- One budget per category per exact range. Overlapping ranges are allowed;
-- the same range twice would be two answers to one question.
alter table category_budgets drop constraint category_budgets_unique;
create unique index category_budgets_range_unique on category_budgets (category_id, start_date, end_date);

alter table category_budgets alter column fiscal_year_hijri drop not null;
comment on column category_budgets.fiscal_year_hijri is
  'DEPRECATED since 0049 — budgets are ranges (start_date, end_date). Kept for '
  'rows written before, and no longer read.';

drop index if exists category_budgets_year_idx;
create index category_budgets_category_idx on category_budgets (category_id, start_date);

comment on column category_budgets.priority is
  'Where budgets overlap, the higher priority keeps the shared days. A new '
  'budget starts lowest; an override lifts it above what it overlaps. See '
  'src/lib/budget-allocation.ts.';

-- ---------------------------------------------------------------------
-- What happened to each budget
-- ---------------------------------------------------------------------
-- An override changes budgets other than the one being saved, and the rule
-- agreed for it was that every override is recorded: who, when, and both
-- amounts. Setting and clearing a budget are recorded the same way.

create table category_budget_changes (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid references category_budgets (id) on delete set null,
  category_id uuid references categories (id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  kind text not null,
  from_amount numeric(12, 2),
  to_amount numeric(12, 2),
  -- For an override: the budget whose saving caused this change.
  caused_by_label text,
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint category_budget_changes_kind_check check (kind in ('set', 'changed', 'cleared', 'moved_by_override'))
);

create index category_budget_changes_category_idx on category_budget_changes (category_id, changed_at desc);

alter table category_budget_changes enable row level security;

-- ---------------------------------------------------------------------
-- Saving, all at once
-- ---------------------------------------------------------------------
-- An override writes the budget being saved and moves others, and each of
-- those is recorded. The arithmetic is done in application code
-- (planBudgetSave); this writes its result in one transaction, so a save can
-- never land half-applied with some totals moved and others not.
--
-- p_budgets: [{ id?, category_id, start_date, end_date, period_code, label, amount, priority }]
--   rows with an id are updated; a row without one is inserted.
-- p_changes: [{ category_id, label, start_date, end_date, kind, from_amount, to_amount, caused_by_label }]
--   budget_id is filled in from the matching budget row.

create or replace function save_category_budgets(
  p_actor uuid,
  p_budgets jsonb,
  p_changes jsonb
) returns void
language plpgsql
as $$
declare
  b jsonb;
  c jsonb;
begin
  for b in select * from jsonb_array_elements(p_budgets) loop
    if nullif(b ->> 'id', '') is null then
      insert into category_budgets (
        category_id, start_date, end_date, period_code, label, amount, priority, set_by
      ) values (
        (b ->> 'category_id')::uuid, (b ->> 'start_date')::date, (b ->> 'end_date')::date,
        b ->> 'period_code', b ->> 'label', (b ->> 'amount')::numeric, (b ->> 'priority')::int, p_actor
      );
    else
      update category_budgets set
        amount = (b ->> 'amount')::numeric,
        priority = (b ->> 'priority')::int,
        set_by = p_actor,
        updated_at = now()
      where id = (b ->> 'id')::uuid;
    end if;
  end loop;

  for c in select * from jsonb_array_elements(p_changes) loop
    insert into category_budget_changes (
      budget_id, category_id, label, start_date, end_date, kind,
      from_amount, to_amount, caused_by_label, changed_by
    )
    select
      (select id from category_budgets
        where category_id = (c ->> 'category_id')::uuid
          and start_date = (c ->> 'start_date')::date
          and end_date = (c ->> 'end_date')::date),
      (c ->> 'category_id')::uuid, c ->> 'label',
      (c ->> 'start_date')::date, (c ->> 'end_date')::date, c ->> 'kind',
      (c ->> 'from_amount')::numeric, (c ->> 'to_amount')::numeric,
      nullif(c ->> 'caused_by_label', ''), p_actor;
  end loop;
end;
$$;

create or replace function clear_category_budget(p_actor uuid, p_budget_id uuid) returns void
language plpgsql
as $$
declare
  v category_budgets;
begin
  select * into v from category_budgets where id = p_budget_id for update;
  if not found then
    return;
  end if;
  insert into category_budget_changes (budget_id, category_id, label, start_date, end_date, kind, from_amount, to_amount, changed_by)
  values (null, v.category_id, v.label, v.start_date, v.end_date, 'cleared', v.amount, null, p_actor);
  delete from category_budgets where id = p_budget_id;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function save_category_budgets, clear_category_budget, hijri_to_gregorian from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function save_category_budgets, clear_category_budget, hijri_to_gregorian from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0049_budget_periods.sql')
on conflict do nothing;
