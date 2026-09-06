# Backup and restore

This system holds the organisation's GST records. The ATO expects them kept for
five years, and a BAS prepared from them has to be defensible. That makes
"could we get this back?" a question with a documented answer rather than an
assumption.

Nothing here is exotic. The point is that someone has read it before the day it
is needed, and that the restore has been rehearsed at least once — an untested
backup is a belief, not a backup.

## What has to survive

Four things, in three places. Losing any one of them loses something the others
cannot reconstruct.

| What | Where | If lost |
|---|---|---|
| Expenses, line items, vendors, pricelist, budgets, teams and permissions | Supabase Postgres | Everything. This is the system. |
| Receipt files | Supabase Storage, `receipts` bucket | The evidence behind every claim. The figures survive; the proof does not. |
| User accounts and passwords | Supabase Auth (`auth.users`) | Everyone is locked out until an admin re-creates them. |
| Environment secrets | Vercel project settings | The app cannot start. |

The database and Auth are backed up together — `auth.users` lives in the same
Postgres instance. **Storage is not.** That is the gap most likely to catch
someone out: a database restore brings back every expense row and every
`storage_path`, pointing at objects that may no longer exist.

## Point-in-time recovery

Turn on PITR for the Supabase project (Settings → Database → Point in Time
Recovery). Daily snapshots alone mean losing up to a day of submissions; PITR
lets a restore land at a chosen minute, which is what you want when the failure
is a bad migration or a mistaken bulk action rather than hardware.

Confirm the retention window is at least 7 days. Most damage of the "wrong
`delete`" kind is noticed within a day; the rest is noticed at month end, and
no realistic retention covers that — see *Reconstructing from the audit trail*.

## Restoring the database

1. **Stop writes first.** Set the Vercel deployment to maintenance, or remove
   `SUPABASE_SERVICE_ROLE_KEY`, so nobody submits into a database about to be
   rolled back. A submission made during a restore is lost with no trace of
   having existed.
2. Supabase dashboard → Database → Backups → restore to the chosen timestamp.
3. Check the migration state matches the code being served:
   ```sql
   select count(*) from information_schema.tables where table_schema = 'public';
   select max(fiscal_year_hijri) from expenses;
   ```
   If the restore predates a migration the deployed app expects, either
   re-apply the migrations from `supabase/migrations` in order, or roll the
   deployment back to the commit that matches.
4. Re-enable writes.
5. **Check storage.** See below.
6. **Refresh the Reports cache.** Admin -> System errors -> "Refresh Reports data".
   Reports reads a cached copy of the ledger that only in-app writes invalidate,
   so after a restore it will otherwise report the figures from before it for
   up to an hour.

## Restoring receipt files

Storage has no PITR. Objects are only ever added by this app and, since
migration 0028, are named by the SHA-256 of their own contents — so a file that
still exists is definitely the right file, and re-uploading one is idempotent.

After any database restore, find rows pointing at objects that are gone:

```sql
select e.expense_number, a.file_name, a.storage_path
from expense_attachments a
join expenses e on e.id = a.expense_id
order by a.created_at desc;
```

Then list the bucket and compare. Anything missing has to be re-uploaded by
whoever submitted it; the expense itself is intact, so the figures and the
approval trail are not at risk — only the evidence.

To take a copy of the bucket before anything risky:

```bash
npx supabase storage download --recursive ss:///receipts ./receipts-backup
```

Worth doing before applying a batch of migrations, and worth doing on a
schedule if anyone is willing to own it.

## Reconstructing from the audit trail

Some damage is not a restore candidate — a bad edit three weeks ago, noticed at
month end, with legitimate work layered on top of it since. For those,
`expense_status_history` is the record: every transition, who made it, when,
and for reversals (0029) why. It is append-only in practice, nothing in the app
deletes from it, and it is the reason a reversal writes a row rather than
editing one.

Read it before assuming a restore is the answer. Rolling back three weeks to
fix one expense costs three weeks of everyone else's work.

## Rehearse it

Once, and again after any significant schema change:

1. Create a scratch Supabase project.
2. Apply `supabase/migrations` in order — the test suite does this on every run
   against PGlite, so failures here are usually environmental rather than in the
   SQL.
3. Restore a real backup into it.
4. Point a local `.env.local` at it and confirm the app starts, an expense
   opens, and a receipt loads.

Step 4 is the one that matters. Steps 1–3 test the backup; only step 4 tests
that the backup is *usable*.

## What is not covered

- **Anthropic and Resend keys** are in Vercel only. Note where they came from;
  both are re-issuable, but not recoverable.
- **The `ABN_LOOKUP_GUID`** is absent from local `.env.local` and may be absent
  in production too. Its failure mode is silent — lookups return "no matches"
  rather than an error — so confirm it is set rather than assuming.
- **Deleted expenses are gone.** Deletion is hard, and since the file cleanup
  landed it removes the receipt too. Only the submitter can delete, and only
  before a decision, so the window is small — but there is no undo.
