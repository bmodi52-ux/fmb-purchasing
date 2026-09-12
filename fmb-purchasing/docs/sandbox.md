# The sandbox

A second copy of the app, at **sandbox.fmbpurchasing.com.au**, where someone can be shown how to submit, approve and
pay without touching anything real. It runs the same code as the live site — every merge reaches both — over its own
Supabase project, seeded from a scrubbed copy of the real data.

What a trainee sees is the real shape of the work: the same vendors, items, prices and history, under invented names.
What they cannot see is anyone's bank account, anyone's address, or anyone's email.

## What is invented, and what is not

| Replaced | Kept as it is |
| --- | --- |
| Vendor names, ABNs and billing addresses | Item names, pack sizes, quantities and prices |
| People's names and email addresses | Expense amounts, dates, GST, approvals and payments |
| Bank account names, BSBs and account numbers | Categories, budgets, teams and their permissions |
| Contact names and phone numbers | Receipt files, exactly as uploaded |
| FMB's own bank details in the ABA settings | Comments and notes, with names inside them rewritten |

Two things follow from that, both decided knowingly:

- **Receipt images are not scrubbed.** The vendor, the ABN and sometimes a bank account are printed on the paper, and
  they stay readable. A trainee can open any receipt in the sandbox and see a real supplier's details.
- **Real people are not copied at all.** Every expense, approval and payment is re-attributed to a trainee, so a
  trainee signs in to their own work rather than impersonating a member.

## Email

The sandbox sends only to the addresses listed in `src/lib/sandbox-trainees.ts`, and every subject starts with
`[Sandbox]`. Anything addressed to scrubbed data is held back and logged instead. That keeps invented addresses from
bouncing off the real sending domain, and keeps training mail away from real suppliers.

## Setting it up, once

1. **Supabase.** Create a project called *FMB Sandbox* in Sydney, then build its schema in one paste:
   ```bash
   node scripts/bundle-migrations.mjs --out sandbox-schema.sql
   ```
   That is every migration in order, 0001 through 0058. Paste it into the new project's SQL editor and run it once.

   `combined_bootstrap.sql` is **not** a shortcut for this: it is an alternative to 0001 alone, and a database built
   from it is forty migrations behind.

   Then mark the project as the sandbox — this is what allows it to be emptied, and what keeps the reset away from
   live:
   ```sql
   update deployment_kind set kind = 'sandbox', marked_at = now();
   ```
2. **This machine.** Create `.env.sandbox` beside `.env.local`, holding the sandbox project's
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It is git-ignored, like every other env file.
3. **The receipts bucket**, pointed at the sandbox rather than live:
   ```bash
   node scripts/create-receipts-bucket.mjs --env .env.sandbox
   ```
4. **Vercel.** Add a second project from this repository, deploying `main`, with these environment variables:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SANDBOX` | `1` — this is what shows the banner and holds back email |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | the sandbox project's |
   | `NEXT_PUBLIC_SITE_URL` | `https://sandbox.fmbpurchasing.com.au` |
   | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | the same as live |
   | `ANTHROPIC_API_KEY` | the same as live, as decided |
   | `CRON_SECRET`, `INBOUND_EMAIL_SECRET` | **leave unset**, so the daily job and the receipts inbox stay off |

5. **DNS.** Point `sandbox.fmbpurchasing.com.au` at that Vercel project.

## Filling it, and resetting it

The same command does both — a reset is simply a fresh fill:

```bash
node --import ./scripts/test-setup.mjs scripts/seed-sandbox.mjs --dry-run
node --import ./scripts/test-setup.mjs scripts/seed-sandbox.mjs
```

The dry run reads everything, reports how much there is and which logins would change, and writes nothing. The real
run empties the sandbox, re-creates the trainee logins, copies the scrubbed data in, and copies the receipt files.
`--skip-files` leaves the receipts alone, which is much quicker when only the data matters.

It refuses to start if `.env.sandbox` points at the same project as `.env.local`, or if the target database has not
been marked as the sandbox. The live database is marked `live` by migration 0058 and nothing in the app ever changes
that, so `sandbox_reset()` cannot run against production.

## Trainees

Add or remove them in `src/lib/sandbox-trainees.ts`, then reset:

```ts
{ name: "New Approver", email: "someone@example.org", teams: ["Procurement"] },
```

A login that already exists is kept, with the password that person already set. A new one is created and its password
printed once by the script — hand it over and have them change it. A login that is no longer listed is removed at the
next reset. Team names are matched against the teams copied from live; a name matching nothing is reported.

## Worth knowing

- **The banner is not dismissible.** It sits at the top of every page, on every screen, including the sign-in page.
- **The daily job is off** unless `CRON_SECRET` is set, so reminders and the receipt-reading check never run there.
- **Resetting mid-session takes the work away** from anyone using it at that moment. There is no warning; tell people
  first.
- **A reset copies everything**, so it gets slower as the real data grows. `--skip-files` is the fast path.
- The old Tokyo Supabase project is not this. It should be deleted; the sandbox is a fresh Sydney project.
