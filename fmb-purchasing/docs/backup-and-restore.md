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
6. **Reports needs no manual step.** It checks the expense count and the most
   recent change before trusting its cache, so a restore is picked up on the
   next page load. There is a forced re-read under Admin → System errors if you
   ever need it — for changes that check cannot see, like a renamed category.

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

## Backing up on a schedule

Two scripts, each recording its run on **Admin → Backups & records**, which
says when either is more than a week old (and reminds admins on Mondays):

```bash
node scripts/backup-data.mjs --out "G:/My Drive/FMB Backups/database"
node scripts/backup-receipts.mjs --out "G:/My Drive/FMB Backups/receipts"
```

`backup-data.mjs` saves every table in `public` (it asks the database for the
list, so new tables are included) and the account list, into a new dated folder
each time. `backup-receipts.mjs` mirrors the `receipts` bucket and only copies
files it doesn't have yet, so after the first run it is quick. A folder synced
by Google Drive keeps a second copy off the machine.

To run both every night at 11pm on Windows, from the `fmb-purchasing` folder:

```bat
schtasks /create /sc daily /st 23:00 /tn "FMB backups" /tr "cmd /c cd /d \"%CD%\" && node scripts/backup-data.mjs --out \"G:/My Drive/FMB Backups/database\" && node scripts/backup-receipts.mjs --out \"G:/My Drive/FMB Backups/receipts\""
```

The machine has to be on at that time; Task Scheduler's "run as soon as
possible after a scheduled start is missed" setting catches the nights it isn't.

## Keeping receipts for five years

Migration 0055 makes the database refuse to lose a receipt inside five years:
once an expense is decided its attachments can't be removed, and an expense with
receipts can't be deleted. Where Supabase allows it, the same migration also
stops files in the `receipts` bucket being deleted inside five years; if the
project doesn't allow a trigger on `storage.objects`, the migration says so and
the database rules still apply. `scripts/cleanup-data.mjs --empty-bucket` is
refused by that rule too, which is intended.

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

Then record it on **Admin → Backups & records** — the date, what was restored,
whether it worked, and anything that went wrong. The page asks again after six
months.

## What is not covered

- **Anthropic and Resend keys** are in Vercel only. Note where they came from;
  both are re-issuable, but not recoverable.
- **The `ABN_LOOKUP_GUID`** is set in local `.env.local`, but it is a personal
  GUID registered at abr.business.gov.au/Tools/WebServices and is stored
  nowhere else — if it is lost, register a new one. Confirm it is set in Vercel
  rather than assuming: the failure mode is silent, and name search returns
  "no matches" rather than an error when it is missing.
- **Withdrawn expenses stay.** Submitters withdraw rather than delete (0043),
  and an expense with receipts can't be deleted for five years (0055).
