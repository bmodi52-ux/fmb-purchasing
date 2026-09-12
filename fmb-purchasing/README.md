# FMB Purchasing

Internal expense system for FMB Sydney (Faiz ul Mawaid il Burhaniyah) — receipt
submission, approval, reimbursement and reporting, at **www.fmbpurchasing.com.au**.

A submitter photographs a receipt — or pastes a screenshot, drops a PDF, or
hands over the forwarded email as a `.eml`; Claude reads it into line items with
GST and per-unit quantities; the Procurement Head approves it; the Treasurer
records the transfer. Reporting then answers what the kitchen is spending, per
category, per vendor, and per kilo.

## Stack

| Piece | What |
|---|---|
| App | Next.js (App Router) on Vercel, region `syd1` |
| Database, auth, file storage | Supabase (Postgres, Sydney) |
| Receipt extraction | Claude API, server-side only |
| Email | Resend — account mail only; expense notifications are in-app |

## Running it

```bash
npm install
npm run dev
```

Needs a `.env.local` — copy `.env.local.example` and fill it in:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | session cookies |
| `SUPABASE_SERVICE_ROLE_KEY` | all data access — see the note on authorization below |
| `ANTHROPIC_API_KEY` | receipt extraction |
| `ABN_LOOKUP_GUID` | ABN lookup — optional, but **silently degrades to "no matches" when unset** |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | welcome, temporary-password and reset emails |
| `NEXT_PUBLIC_SITE_URL` | only to make reset links point somewhere local |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push notifications — `npx web-push generate-vapid-keys`; without them push is off |
| `CRON_SECRET` | the daily reminders job (`/api/cron/daily`, scheduled in `vercel.json`); without it the job refuses every call |
| `INBOUND_EMAIL_SECRET` | receipts forwarded by email (`/api/inbound-email`); without it every post is refused — see `docs/receipts-by-email.md` |
| `INBOUND_EMAIL_ADDRESS` | the forwarding address shown on Submit (optional) |
| `NEXT_PUBLIC_SANDBOX` | set to `1` on the sandbox deployment only: shows the banner and keeps email to trainees — see `docs/sandbox.md` |

```bash
npm test          # 323 tests, incl. migrations applied to a real Postgres
npx tsc --noEmit  # the check ESLint cannot do
npx eslint .
```

CI runs all three on every pull request.

## How it is put together

Read these three notes before changing anything; each explains a decision that
looks wrong until you know why.

**Authorization is in application code, not RLS.** Every table has RLS enabled
with a default-deny policy, and the app reaches the database exclusively through
the service-role key from Server Actions. Permissions are rows in
`team_permissions`, checked by `src/lib/permissions.ts`. RLS is the backstop for
the anon key ever leaking, not the mechanism. See the header of
`supabase/migrations/0001_init.sql`.

**The fiscal year is Hijri.** 1 Shawwal to the day before the next 1 Shawwal —
twelve lunar months, ending in Ramadan. `src/lib/hijri/hijri.ts` is a verified
Fatimi/Misri tabular implementation with its own test suite; `src/lib/fiscal-year.ts`
wraps it. Dates are computed in `Australia/Sydney`, never in the server's UTC.

**Money arithmetic lives in two places on purpose.** `src/lib/expense-money.ts`
and `src/app/(app)/reports/aggregate.ts` are pure and tested; the SQL costing
views in `supabase/migrations/0010_cost_views.sql` (as amended by 0014 and 0026)
are tested against a real Postgres. Two rules matter throughout:

- The receipt total is **captured, never computed.** The line items must account
  for every dollar of it — a card surcharge or a discount is its own line with a
  `kind`, not something absorbed into the total. Enforced in
  `create_expense_with_lines`.
- GST is a property of **the line**, not a share of the total. Most of what this
  kitchen buys is GST-free.

## Migrations

Plain SQL in `supabase/migrations`, applied in filename order. There is no
migration tool: run them against the Supabase SQL editor in order, or let the
test suite apply them from scratch to PGlite, which it does on every run — so
a migration that does not apply cleanly fails CI.

Useful scripts in `scripts/`:

| Script | Does |
|---|---|
| `bootstrap-admin.mjs` | creates the first user and grants them everything |
| `seed-categories.mjs` | applies the category list |
| `create-receipts-bucket.mjs` | creates the private `receipts` storage bucket |
| `compare-extraction.mjs` | runs real receipts through several models and scores them — `--dry-run` first, it spends money |
| `dry-run-sql.mjs` | applies a migration to a throwaway database |

## Backups

See [docs/backup-and-restore.md](docs/backup-and-restore.md). The short version:
turn on PITR, and remember that Storage is not covered by it — a database
restore brings back every `storage_path` pointing at objects that may no longer
exist.

## Design

Colours are sampled from the FMB crest, not chosen: gold `#D89C24`, deep gold
`#A97614`, maroon `#4A160A`, palm green `#009C48`, cream `#FBF6EC`, ink
`#2B211C`. Fraunces is reserved for the wordmark; Inter carries headings and
body; IBM Plex Mono carries amounts, dates and identifiers. Tokens live in
`src/app/globals.css`.
