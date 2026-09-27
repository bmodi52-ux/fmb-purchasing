# Monitoring

How breakage is noticed without anyone having to look (scratchpad #46).

## Is the site up?

`GET /api/health` answers `200` with `{"status":"ok"}` when the database is reachable and has every migration the
deployed code expects, and `503` otherwise, with which of the two is wrong. It is public and says nothing more.

UptimeRobot (free plan) calls it every 5 minutes and emails when it fails. Set it up with a new HTTP(s) monitor on
`https://www.fmbpurchasing.com.au/api/health`, alerting on anything but `200`.

There used to be a GitHub Actions check, `.github/workflows/uptime.yml`, every 15 minutes. It was removed on
2026-09-27 when the repository went private (scratchpad #37): private repositories get 2,000 free Actions minutes
a month, and that check alone used about 2,900.

A `503` straight after a deploy usually means a migration hasn't been run in the Supabase SQL editor yet —
**Admin → System errors** lists which.

## Did something fail?

Failures the app catches are recorded on **Admin → System errors**. The first time each kind of failure happens,
everyone who administers accounts is notified in the app, by push and by email; repeats of the same failure are
counted on its row but not sent again. Each person can change those channels on their notification settings.

The reading check (App settings → Receipt reading check) and overdue backups (Admin → Backups & records) notify
the same people.

## Does the whole path still work?

`src/lib/lifecycle-end-to-end.test.ts` takes one expense from submission, through approval and payment, into a
bank file and a Xero bills row, then reverses the payment and checks a lodged quarter can't be reversed. It runs
with every other test on each pull request. Checking the pages themselves in a browser needs a signed-in test
account against a copy of the database — the sandbox in scratchpad idea #1.
