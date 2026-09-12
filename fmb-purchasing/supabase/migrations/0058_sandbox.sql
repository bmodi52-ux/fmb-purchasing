-- The sandbox (scratchpad #1): a second database, seeded from a scrubbed copy
-- of the real one, for training people without touching anything real.
--
-- The code and the migrations are the same in both places, so the difference
-- has to live in the database itself. Every database says which it is, and
-- says "live" unless someone deliberately marks it otherwise — so the reset
-- below cannot run against production even if the wrong key is pasted into
-- the wrong terminal.

create table deployment_kind (
  -- One row, forever: the check and the default make a second row impossible.
  id boolean primary key default true check (id),
  kind text not null default 'live' check (kind in ('live', 'sandbox')),
  marked_at timestamptz not null default now()
);

insert into deployment_kind (id, kind) values (true, 'live')
on conflict (id) do nothing;

comment on table deployment_kind is
  'Whether this database is the live one or the sandbox. A sandbox is marked by hand, once: '
  'update deployment_kind set kind = ''sandbox'', marked_at = now();';

/**
 * Empties the sandbox so it can be seeded again from scratch.
 *
 * Refuses outright unless this database has been marked as the sandbox. The
 * receipt-retention rules from 0055 would otherwise refuse the deletes, which
 * is why this truncates rather than deleting row by row — truncate does not
 * fire row triggers.
 *
 * What survives: the page and action registry, the migration ledger, the
 * units, and this table. Everything else is re-seeded by
 * scripts/seed-sandbox.mjs.
 */
create or replace function sandbox_reset()
returns void
language plpgsql
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function sandbox_reset from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function sandbox_reset from authenticated';
  end if;
end $$;

alter table deployment_kind enable row level security;

insert into schema_migrations (filename) values ('0058_sandbox.sql')
on conflict do nothing;
