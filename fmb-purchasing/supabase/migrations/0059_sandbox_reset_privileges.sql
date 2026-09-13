-- Two things the first sandbox reset found (scratchpad #1).
--
-- 1. TRUNCATE ... RESTART IDENTITY needs to own the sequences, and the app
--    connects as service_role, which does not. The function now runs as its
--    owner. It still refuses unless the database says it is the sandbox, and
--    is still revoked from anon and authenticated, so running as the owner
--    grants no one a new way in.
--
-- 2. Restarting the sequences is only half the job. Expenses, items and
--    vendors carry their own numbers, and a seeded sandbox holds copied rows
--    numbered from live — so a sequence sitting at 1 would hand the next
--    submission a number that is already taken. The seed calls
--    sandbox_sync_sequences() when it has finished writing, which moves every
--    sequence past the data.

create or replace function sandbox_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_table text;
begin
  select kind into v_kind from deployment_kind;
  if v_kind is distinct from 'sandbox' then
    raise exception 'sandbox_reset refused: this database is marked %, not sandbox', coalesce(v_kind, 'unknown')
      using errcode = 'P0001';
  end if;

  -- Every table except the registry the migrations own, so a table added by a
  -- later migration is emptied too rather than quietly keeping its rows.
  -- One at a time with cascade, which sorts out the foreign keys itself.
  for v_table in
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name not in ('app_pages', 'app_actions', 'schema_migrations', 'deployment_kind')
    order by table_name
  loop
    execute format('truncate table public.%I restart identity cascade', v_table);
  end loop;
end;
$$;

/**
 * Moves every sequence past the rows now in the table, so the next expense,
 * item or vendor created in the sandbox gets a number nobody holds.
 *
 * Safe to run twice: it sets each sequence from the data rather than stepping
 * it on, so a second run changes nothing.
 */
create or replace function sandbox_sync_sequences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  r record;
  v_max bigint;
begin
  select kind into v_kind from deployment_kind;
  if v_kind is distinct from 'sandbox' then
    raise exception 'sandbox_sync_sequences refused: this database is marked %, not sandbox', coalesce(v_kind, 'unknown')
      using errcode = 'P0001';
  end if;

  for r in
    select
      c.table_name,
      c.column_name,
      pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) as sequence_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and (c.is_identity = 'YES' or c.column_default like 'nextval%')
  loop
    if r.sequence_name is not null then
      execute format('select coalesce(max(%I), 0) from public.%I', r.column_name, r.table_name) into v_max;
      -- is_called false when the table is empty, so the first row gets 1.
      perform setval(r.sequence_name, greatest(v_max, 1), v_max > 0);
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function sandbox_reset, sandbox_sync_sequences from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function sandbox_reset, sandbox_sync_sequences from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0059_sandbox_reset_privileges.sql')
on conflict do nothing;
