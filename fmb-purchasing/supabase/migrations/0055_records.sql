-- Audit trail and records (scratchpad #45): vendor history, keeping receipts
-- for five years, and a record of backups and restore rehearsals.

-- ---------------------------------------------------------------------
-- Vendor history
-- ---------------------------------------------------------------------
-- Written by the app beside each change, the way item_history is, so each
-- entry says who made it. Bank details are recorded as events — "an account
-- was added", "confirmed", "replaced" — never with the numbers, because this
-- history is shown to everyone who can see the vendor.

create table vendor_changes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors (id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- Null when the app did it on its own, such as a GST registration check.
  changed_by uuid references profiles (id) on delete set null,
  kind text not null check (kind in (
    'created', 'details_changed', 'usual_settings_changed', 'reviewed',
    'contact_added', 'contact_removed', 'address_added', 'address_removed',
    'bank_account_added', 'bank_details_changed', 'bank_account_replaced',
    'bank_account_proposed', 'bank_account_confirmed', 'bank_account_discarded',
    'gst_registration_changed'
  )),
  -- { field: { old, new } } for changed fields, or { label } for an event.
  changes jsonb not null default '{}'::jsonb
);

create index vendor_changes_vendor_idx on vendor_changes (vendor_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Receipts are kept for five years
-- ---------------------------------------------------------------------
-- The ATO expects records kept five years. A receipt attached to an expense
-- can't be removed inside that time once the expense has been decided, and
-- an expense carrying receipts can't be deleted at all inside it. While an
-- expense is still waiting for a decision, its submitter can still swap a
-- wrong file for the right one.

create or replace function receipt_retention_until(p_expense_id uuid)
returns date
language sql
stable
as $$
  select (greatest(e.created_at::date, coalesce(e.receipt_date, e.created_at::date)) + interval '5 years')::date
  from expenses e
  where e.id = p_expense_id;
$$;

create or replace function guard_attachment_delete()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_until date;
begin
  select e.status::text, receipt_retention_until(e.id) into v_status, v_until
  from expenses e
  where e.id = old.expense_id;

  -- The expense itself is being deleted; guard_expense_delete decides that.
  if v_status is null then
    return old;
  end if;

  if v_status <> 'submitted' and current_date < v_until then
    raise exception 'Receipts are kept for five years: this one can''t be removed before %.', v_until
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger expense_attachments_retention
  before delete on expense_attachments
  for each row execute function guard_attachment_delete();

create or replace function guard_expense_delete()
returns trigger
language plpgsql
as $$
declare
  v_until date;
begin
  if exists (select 1 from expense_attachments a where a.expense_id = old.id) then
    v_until := (greatest(old.created_at::date, coalesce(old.receipt_date, old.created_at::date)) + interval '5 years')::date;
    if current_date < v_until then
      raise exception 'Receipts are kept for five years: an expense with receipts can''t be deleted before %.', v_until
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end;
$$;

create trigger expenses_retention
  before delete on expenses
  for each row execute function guard_expense_delete();

-- The files themselves. Supabase manages the storage schema, and a project
-- may not let this migration add a trigger there; if so it says so and moves
-- on, and the database guards above still stop the app from losing track of
-- a receipt.
do $outer$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    begin
      execute $fn$
        create or replace function public.guard_receipt_file_delete()
        returns trigger
        language plpgsql
        as $body$
        begin
          if old.bucket_id = 'receipts' and old.created_at > now() - interval '5 years' then
            raise exception 'Receipt files are kept for five years.' using errcode = 'P0001';
          end if;
          return old;
        end;
        $body$
      $fn$;
      execute 'drop trigger if exists receipts_retention on storage.objects';
      execute 'create trigger receipts_retention before delete on storage.objects for each row execute function public.guard_receipt_file_delete()';
    exception when insufficient_privilege then
      raise notice 'Could not guard storage.objects (%). Receipt rows are still guarded.', sqlerrm;
    end;
  end if;
end;
$outer$;

-- ---------------------------------------------------------------------
-- Backups and restore rehearsals
-- ---------------------------------------------------------------------
-- The backup scripts record each run here, and admins record each time a
-- restore was rehearsed, so "when did we last check we could get this back?"
-- has an answer on the Records page.

create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('database', 'receipt_files')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  -- Rows for a database backup, files for receipts.
  item_count int not null default 0,
  new_count int not null default 0,
  bytes bigint not null default 0,
  problems int not null default 0,
  -- Where it was written, as the machine that ran it named it.
  destination text,
  note text
);

create index backup_runs_kind_idx on backup_runs (kind, finished_at desc);

create table restore_rehearsals (
  id uuid primary key default gen_random_uuid(),
  rehearsed_on date not null,
  what text not null check (what in ('database', 'receipt_files', 'both')),
  succeeded boolean not null,
  notes text,
  recorded_by uuid references profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

-- Every table in public, so the database backup script keeps up with new
-- migrations instead of carrying a list that goes stale.
create or replace function public_table_names()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select table_name::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name;
$$;

alter table vendor_changes enable row level security;
alter table backup_runs enable row level security;
alter table restore_rehearsals enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public_table_names, receipt_retention_until from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public_table_names, receipt_retention_until from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0055_records.sql')
on conflict do nothing;
