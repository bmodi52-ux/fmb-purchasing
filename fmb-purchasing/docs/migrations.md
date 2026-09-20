# Running a migration

Every migration has to be run in **both** projects — the sandbox and live.
Until 0062 that meant pasting SQL into two dashboards, and on 2026-07-29 a
migration went into the wrong one: the two look identical apart from the
project ref in the URL.

## Setup, once per machine

For each project, copy its **session pooler** connection string from the
Supabase dashboard (Connect → Session pooler), put the database password into
it, and add it to that project's env file:

The password can go in the URI, or — easier, since database passwords are
full of characters a URL treats specially — on its own line as
`SUPABASE_DB_PASSWORD`, which wins over whatever the URI holds.

```
# fmb-purchasing/.env.sandbox  — the FMB Sandbox project
SUPABASE_DB_URL=postgresql://postgres.vnlhzndfycelmqamqtkl:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres

# fmb-purchasing/.env.local    — live
SUPABASE_DB_URL=postgresql://postgres.xcfvckicyyhveyzwogny:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
```

The **session pooler**, not the direct host: `db.<ref>.supabase.co` is
IPv6-only and does not resolve from this machine. Both env files are
git-ignored, like every other key.

## Running one

```bash
# what hasn't been run here yet
node scripts/run-migration.mjs --env .env.sandbox --pending

# the sandbox first, always
node scripts/run-migration.mjs --env .env.sandbox 0063_something.sql

# then live, which has to be said out loud
node scripts/run-migration.mjs --env .env.local --live 0063_something.sql
```

What it will not do:

- run anything that is not a numbered file in `supabase/migrations`,
- run a migration the ledger says has already been applied,
- touch a database that says `deployment_kind = 'live'` without `--live`,
- leave a half-applied file behind: the whole migration runs in one
  transaction and rolls back on any error.

It prints the project ref and whether the database calls itself live or
sandbox **before** applying anything, and checks afterwards that the
migration recorded itself in `schema_migrations`.
