# Scratch pad: delivered

Everything raised and finished, newest first, kept out of the scratch pad so
that what is still open stays readable. Numbers never change and are unique
across both files — see scratchpad.md.

## Delivered

### 77. A simple mode that is just the sheet, typed

Delivered 2026-09-21. One setting for everybody, in App settings: a day's
menu is typed as text and what to buy is typed under it, under the list it
belongs to. Everything after it is unchanged — release, the section lists,
who buys what, ordered and delivered, the receipts tying back — because a
typed quantity is stored as the same requirement a recipe would have
produced. A typed line reads "typed in" where a costed one names its dish.
Nothing is thrown away when the setting is changed: a day keeps what it
holds, and both kinds of line are costed and released together.

Two defects found while checking it: a typed day could not be released at
all, because the release control still required dishes and a thaali count;
and changing the setting left every day page showing the old way, because
only /menus was revalidated.

### 76. A thaali is a set of boxes, and not everybody takes all of it

Delivered 2026-09-21. The count moved from the day to the line: each dish on
a menu says how many boxes a thaali may take and how many boxes to fill, and
left blank the day assumes everybody takes everything it offers. Roti and
fruit are parts of a thaali without being dishes — the day names the item,
how much goes in a thaali, and how many take it — and roti buys on a list of
its own, with its own person, because bread would otherwise fall in with the
rice and the oil. Fruit is bought with the produce, as asked.

The per-line counts are typed when the menu is set up, defaulting to the
day's thaali count; when the RSVP tool eventually collects per-dish choices,
its figures replace the typed ones and nothing else changes.

Found while checking: an input of min 0.01 and step 0.05 silently refuses the
value 1, so a roti of one each could not be saved at all.

### 75. No way to set a menu on a day that has none

Delivered 2026-09-21. Every empty day in the month now says "+ Set a menu".
Before, the only way in was the date number in the corner, which does not
read as a control.

### 74. Call the Menus page what it is

Delivered 2026-09-21 as "Thaali menu" — the sidebar, the headings, the tab
titles and the permission label. The key stays `menus`, because that is what
every permission row refers to; only what people read changed.

### 73. Procurement dates should open on this week

Delivered 2026-09-21. To buy and Shopping lists open on this week, Monday to
Sunday, with arrows either side and the week named on screen. The date boxes
are still underneath for a range that is not a week — a butcher's order
spanning a fortnight — and the arrows then step from wherever that range
starts. Twenty tests on the week arithmetic, including the cases that catch
people: Sunday belongs to the week just gone, and a week crossing a month or
a year still runs Monday to Sunday.

### 72. "Boxes per batch" stays on screen for a per-box recipe

Delivered 2026-09-21. The pair moves as one now: the batch size appears only
when the recipe is written per batch, on both dish forms.

### 71. A wrong pack size makes "last paid" ten times too high

Delivered 2026-09-21. When a receipt's own reading and the pack's maths are
five times or more apart, neither is stated as a price: the line is kept,
marked, and left out of the latest paid, the cheapest paid lately, and the
purchase a later one is compared against. An item whose every purchase is in
dispute has no cost at all, which is the same answer as an item nobody has
bought. Whoever can fix it is told in the words that name the fix — "the
receipt reads 20 kg, but the pack it is matched to makes it 2 kg" — beside
the other price flags, in front of an approver.

On live this set aside seven lines, all the same fault: a pack missing its
multiplier. Ginger went from $100.00/kg to $12.50/kg. Rice has no last-paid
price at all until its pack is corrected, because its only purchase is the
disputed one.

Deliberately not caught: a reading in another unit, a receipt that says
nothing about quantity, and a difference short of five times — somebody
writing 70 kg for four 15 kg bags is rounding, not a wrong pack.

### 69. Show the total of what's selected

Delivered 2026-09-21. "3 selected · $6,327.15" wherever rows carrying money
can be selected: Payments, Approvals, My submissions, All expenses and Line
items. Lists with no money in them still say only how many. Both table
components share one summary function, so the two halves of the app agree by
construction. Money is added in cents, because a run of two-decimal amounts
summed as floats drifts and this is the figure somebody checks against a bank
statement.

### 68. Filter on any column, on every list

Delivered 2026-09-21 on the lists where it was asked for: Payments,
Approvals, My submissions, Budgets and Backups & records all carry the
per-column filter menu the Expenses and Pricelist tables already had, using
the same matching module, with a Clear that says how many are on. These lists
draw their own tables — a payment row carries an account status and a Mark
paid button — so the filters sit above the table rather than in the headings,
each carrying its column's name.

Backups & records showed its last ten runs, which is not a log worth
filtering; it shows two hundred now.

Left alone after looking at each: Needs attention is a grouped queue of links
whose grouping is its filter; Accounting and Teams & permissions are matrices
where "filter by column" has no meaning; Notifications and Stand-ins are
settings with toggles.

### 65. The old Tokyo Supabase project is gone

Deleted 2026-09-20. It had been kept as the rollback since the move to Sydney
and held only pre-migration test data. With it goes the standing hazard of
running a migration against the wrong dashboard: there is now one project,
`xcfvckicyyhveyzwogny` (Sydney), beside the sandbox.

### 61. A voucher or discount below the total is taken off

Fixed 2026-09-20. A Campbells invoice printed "TOTAL 1498.31", "Customer
Voucher 5 74.51", "VISA EFT 1423.80"; the reading kept 1498.31 and left the
voucher in its note, so the claim was $74.51 more than the card was charged.
The model now reports what was actually paid and what the deduction was
called, and the app turns the difference into a GST-free discount line. On the
real invoice: 17 lines adding to $1,423.80, twice in a row. Saying it in prose
instead was tried first and made the model unreliable at reading lines at all.

### 62. A discount can be entered as a percentage

Done 2026-09-20. A discount line takes a % in place of its quantity, works the
amount out from the goods and service lines before charges, and follows them
as they change. The amount is still what is stored and stays editable; typing
over it drops the percentage.

### 60. Submit: a pack size the item doesn't have yet

Done 2026-09-20. The pack dropdown shows whenever an item is known — including
when it has only one pack, which used to be filed against silently — and
offers a new pack size, filled in from the line (8 at 24 kg is 3 kg each). The
pack and the vendor's offer are created on submit, contents confirmed, and an
identical pack is reused rather than doubled.

### 63. The money flags sit beside the Total, in red

Done 2026-09-20. Money not on the receipt, a changed total and an unexplained
difference now sit under the Total rather than in the chip row above, and are
red (`--color-alert`) on the expense page, in Approvals and on the line.

Found and fixed while checking it: the loading screen from #57 counted its
wait with a one-second timer, which re-rendered the Suspense fallback
continuously and stopped React committing the page behind it — any navigation
could hang on "Loading…" until a reload. It is now revealed entirely by CSS
and never sets state.

### 54. Item Details: "Measured in" shows the old unit after saving

Fixed 2026-09-20. React resets a form after saving, and a dropdown came back
showing the value the page first loaded with (or its first option), so saving
again undid the change. The item details, pack size, offer and Buying forms
redraw their fields from the saved values after each save; the vendor, app
settings and notification dropdowns are keyed on their saved value.

### 58. Handwritten receipt: only the first 4 of 18 lines were read

Fixed 2026-09-20. Read again, the same photo gave 17 lines, then 6. The prompt
now asks for every row to the last and a check against the total, which read
all 18 three times out of three; lines still well short of the total are read
a second time, keeping the reading closer to the total. The Submit form says
plainly when a large part of a receipt isn't itemised.

### 51. Receipt total mismatch: warn and flag, don't block

Done 2026-09-20 (migration 0060, run on sandbox and live). The scanned total
is locked and changing it needs a reason; a line can be marked "Not on this
receipt" with a required note and GST off; a remaining difference needs
"Submit anyway" rather than blocking. The expense page and Approvals flag all
three with the submitter's reasons. expenses.total is the claim (the sum of
the lines); the receipt total is kept beside it.

### 53. Pricelist item page: split into tabs

Done 2026-09-20, as decided: Overview, Settings, History, each its own address.
Also covers #52 (Buying is on Settings).

### 55. Vendor item descriptions: show where each one came from

Done 2026-09-20. Each description says which expense it came from, with links
to the expense and its receipt, and how many receipts use it; otherwise that it
was kept from an old name, or who added it. Worked out from the expense lines
and rename history, so older descriptions answer too.

### 56. Tables: rearrange columns, and remember the order

Done 2026-09-20. Drag a heading, or drag or use the arrows in the Columns menu;
saved to the person's profile, with Reset to default. Exports follow the
order. Every table built on ColumnsDataTable.

### 57. Long "Loading…": say what's loading, offer Try again, log slow pages

Done 2026-09-20. Names the page; after 8s "taking longer than usual" with Try
again; after 20s "something may be wrong" with a way home. Slow loads go on
System errors, grouped by page.

### 59. Submit: Vendor and Vendor # as dropdowns, still searchable

Done 2026-09-20. ▾ lists every approved vendor, the five most recent first;
typing filters, and "8" finds V-0008. Keyboard works; a new name can still be
typed.

### 1. Sandbox environment for training and testing

Live at sandbox.fmbpurchasing.com.au, built to the decisions of 2026-09-10 and
the three settled on 2026-09-12: email reaches trainees only, a reset copies
everything, and trainees are a list in the repo.

A separate Sydney Supabase project (FMB Sandbox) and Vercel project
(fmb-sandbox), deploying `main` like live. `NEXT_PUBLIC_SANDBOX=1` puts an
undismissable banner on every page and holds email to trainees, prefixed
[Sandbox]. `scripts/seed-sandbox.mjs` fills or resets it from a scrubbed copy
of live — vendor names, people, bank details, addresses and emails invented and
stable across resets, and real names rewritten inside free text. Real people
are not copied; their work is attributed to trainees. Receipt images are copied
unscrubbed, as decided. Item, expense and vendor numbers differ from live,
because the database generates them.

Guarded twice: every database says whether it is live or sandbox (0058), and
`sandbox_reset()` refuses anywhere marked live (0059); the seed also refuses if
`.env.sandbox` points at the live project. How to set up, reset and add
trainees is in `docs/sandbox.md`.

Left for later, as decided: an admin reset button, ideally one that starts a
GitHub Action so the live key never sits in the sandbox.

### 25. Record which migrations each database has had

A `schema_migrations` ledger (0041), written to by every migration from 0041
on, with `scripts/migration-status.mjs` listing what a database still needs and
System errors warning when it is behind. A test fails if a migration forgets to
record itself.

### 20. Approving and paying can half-fail without anyone knowing

One database function per action (0042): `decide_expenses`, `reopen_expense`,
`pay_expenses` and `reverse_payment`, each writing the status, the history row
and the payment run together, and reporting failure instead of showing success.

### 23. Withdraw a submission instead of deleting it

Submitters withdraw rather than delete (0043, 0044), so the history stays. A
withdrawn expense has its own tab and can be submitted again, and it counts as
spend nowhere.

### 24. Record changes to teams and permissions

Every change to teams, memberships, permissions and accounts is recorded with
who made it (0045), shown as "Recent changes" on the Teams page. Automatic
enrolments say so.

### 21. Show possible duplicates to the approver

"Possible duplicate of E-0123" now appears on Approvals and Payments as well as
on the submit form, matched by receipt file or by vendor and invoice number.
Switchable from App settings, as asked.

### 22. Choose the financial year: Hijri or Australian

Any period, chosen on the page: Hijri year (Shawwal–Ramadan, Fatimi/Misri), the
Australian financial year, a calendar year, a quarter, a month, or custom dates
(0049). Reports, Budgets, All expenses, Accounting and dashboard widgets all
take it.

Budgets carry across calendars as decided: a budget is a date range, the older
one keeps its days, and a newer one's remainder spreads over the days it does
not cover. Saving over an existing budget warns first and offers to override,
and monthly phasing weights the days.

### 48. Show GST under category and item filters

Reports load each line's own GST, so it holds under any filter. Lines from
before 0026 are marked as apportioned from the receipt total.

### 50. Check the lines' GST against the receipt

The GST printed on the receipt is stored (0048) and the approver is told when
the lines disagree with it. Equipment lines over the threshold in App settings
are marked as capital purchases, which the GST return reports separately.

### 30. Check a vendor's GST registration

The ABR's answer is read on vendor creation, when an ABN changes, on submission
when it is over 30 days old, and on demand from a "Check with the ABR" button
(0047). GST charged by a vendor that is not registered, or whose ABN is
cancelled, is flagged to the approver.

### 27. Reminders for things left waiting, then escalation

A daily job at 8am Sydney sends one summary per person for anything waiting
longer than the limit, then escalates to their stand-in or a chosen team. The
limits, the escalation teams and the weekly master-data reminder are all set on
App settings; defaults were chosen rather than asked for, as agreed.

### 28. Push notifications

Each person chooses how every kind of notification reaches them — in the app,
by push, by email (0050). Teams can set defaults or require a channel, and the
app locks escalations to push and email. Admins can post announcements and
build alert rules from set parts (when, only if, tell), which now include price
moves and unusual spend.

### 35. A stand-in approver for a date range

Whoever holds approving or paying names their own stand-in and the dates
(0051). The stand-in gains only those duties, only between those dates, and
each nomination is recorded with the permission changes.

### 37. Payments: bank file, remittance, and statement matching

An ABA batch file from a payment run, a remittance advice emailed to the payee,
and a bank statement CSV imported to confirm the money actually left (0052).
FMB's own bank details live on App settings, as the header needs them.

### 38. Accounting: account codes, GST summary, and a Xero integration plan

**Partly done.** An account code per category, a GST summary for any period
(G10, G11, 1B, GST-free), a flag on GST over $82.50 without a tax invoice, and
lodged periods locked against reopening or reversal (0052). A Xero bills CSV
exports one draft bill per expense, and `docs/xero-integration.md` holds the
plan.

Still to answer, before a live Xero connection: the chart of accounts export,
how purchases reach Xero today, cash or accrual GST, and who holds Xero admin.

### 39. Budgets and cost centres

**Partly done.** Budgets are ranges in any calendar, with committed spend
counted, the position shown on the approval row ("Meat: 82% used, this takes it
to 86%"), alerts at 80% and 100% to whoever sets budgets, and optional monthly
phasing (0049, 0052).

Cost centres and events were left for later, as decided; the list of them, and
whether they sit per expense or per line, is still to come from FMB.

### 29. Pricelist: price alerts, preferred vendors, and price list import

An alert when a price per kg, litre or each moves further than the limit from
the last purchase (0053). The limit is set for the whole Pricelist (10% up and
down to start), per category and per item, with an optional expected price
range per item. Each item can name a preferred vendor, and a "Cheapest
recently" column shows the lowest price actually paid. A supplier's price list
imports from CSV or Excel, read in pieces by the same reader as a photographed
list.

### 42. Flag unusual spend and price jumps

An expense at least three times its vendor's usual — the median of that
vendor's expenses in the year before, once there are five to judge by — is
flagged on Approvals and on the expense, alongside #29's price flags. The
multiple and the history needed are adjustable.

### 41. Saved report views

A report's period, filters and section save under a name (0053). The owner
keeps it private, shares it with everyone who can see Reports, or with chosen
teams; others open or copy it, and only the owner changes or deletes it.

### 49. Receipt capture: forwarding address, supplier defaults, quality checks

Receipts forwarded to the app's address wait on the sender's Submit page
(0054); `docs/receipts-by-email.md` covers connecting an email service. Each
vendor has usual settings — category, who is paid, GST treatment — filled in on
Submit where the receipt left a gap. A blurry photo is caught before upload,
and a total that could not be read says so. The confirmed receipts are read
again every 30 days, a few each morning, and admins are told if accuracy drops.

### 45. Audit trail and records

Every change to a vendor is recorded with who made it and shown on its page
(0055), bank changes as events without the numbers. The database refuses to
lose a receipt inside five years. A Backups & records page tracks database and
receipt-file backups and restore rehearsals, warns when either is overdue, and
reminds admins on Mondays; `scripts/backup-receipts.mjs` mirrors the bucket.

### 47. Offline receipt capture

A photo taken with no signal stays on the phone and is sent once it is back
online, waiting on Submit beside emailed-in receipts (0056). When the app
cannot be reached at all, the service worker shows a page that still takes
photos.

### 46. Engineering and reliability

An end-to-end test takes one expense from submission through approval and
payment into a bank file and a Xero row, then reverses it. `/api/health`
answers whether the database is reachable and its migrations current, and a
GitHub schedule calls it every 15 minutes. A new kind of background failure now
reaches admins by push and email. `docs/monitoring.md` explains all three.

### 17. Approvals and My submissions: optimise and streamline

All twelve options, decided 2026-09-11.

Approvals: a summary line ("10 expenses · $4,382.10 · oldest waiting 5 days");
each row carries amount, receipt date, line count, receipt, the submitter only
when there is more than one, flags (bank account not confirmed, new vendor, new
Pricelist items) and the submitter's note, with Approve and Decline on the row —
Decline asks for a reason. "Review one by one" shows the receipt beside the
lines and opens the next expense after each decision; Details also shows the
receipt inline. Select all on both pages.

My submissions: "+ Submit another expense" and two summary tiles (waiting for
approval, approved but not paid); tabs with counts, opening on Declined when
there is one; compact rows that open for details; a Submitted → Approved → Paid
line with dates; declined expenses first, with the reason and "Fix and
resubmit", which opens a corrected copy in the submit form while the declined
one stays on record.

### 16. Add items by taking a photo

"Add item by photo" in the menu, and "Add by photo" on a vendor's Products tab.
Up to four photos — price tag, label, or a supplier's price list as a photo or
PDF — are read into products, each looked up on the Pricelist. The details are
checked in plain words (what it is, how it's sold, how much is in it, how many
in the box, the price) and the item, pack size and this store's price are set up
behind the scenes. Someone who can't edit the Pricelist adds records for review
and never overwrites a price on file. A price list reads into several products
at once, which also covers #15's price sheets from a photo or PDF; pasted lines
and spreadsheets were not built.

### 15. Vendor Products tab: a better display, and seamless adding

Built 2026-09-11: grouped by category and then item, with pack sizes under
each; search; All / Needs a price / Waiting for review chips; last paid beside
the price on file, flagged when they differ by 1% or more; Add or Edit price in
place, recorded in history; Approve / Reject on pending offers; one "+ Add
product" flow that searches the Pricelist first and offers "Add '…' as a new
item" when nothing matches; and a layout that stacks on a phone.

### 14. Vendor page: split into subpages

Tabs at the top of each vendor page: Details (the vendor record, payment
details, collection addresses, contacts) and Products (N). Each tab has its own
address, and only loads what it shows.

### 13. Submit on a phone: keep Submit pinned in reach

Submit and Discard sit in a bar pinned to the bottom of the screen on phones,
with any error explaining a refused submission right above them. On a computer
they stay at the end of the form.

### 12. Reports charts: tap to see a value

Tapping a column or a line shows its value, and it stays after the finger lifts
rather than vanishing. Tapping a ranking bar shows its full name and figures. A
mouse still works by hovering.

### 11. Receipt upload: a "Take photo" button

On a phone the upload screen has "Take a photo of the receipt", which opens the
rear camera directly. File upload, drag and paste are unchanged.

### 10. Expenses, Pricelist and My submissions on a phone: a card view

Every list built on the shared table (Expenses, Pricelist, Vendors, Users) shows
a card per row on phones: the first column as the title, the rest as labelled
values, the expand arrow kept, and a Sort by control since cards have no column
headings. My submissions already used cards; its top row now wraps, so a long
vendor name no longer pushes the date off screen, and Edit / Delete are easier
to tap.

### 9. Payments on a phone: one card per expense

A card per expense with vendor, entry number, submitter and invoice number, the
amount, who to pay, approval date and receipt, and the payment reference, date
and Mark paid together at the bottom.

### 8. Submit on a phone: line items as cards

One card per line on phones: type and remove, item number and description with
the Pricelist suggestions, the Pricelist match, category, quantity / unit price
/ line total, and GST. The ten-column table stays on larger screens.

### 7. Mobile review: bugs and quick wins across the app

- Fields are 16px on touch screens, so iPhone no longer zooms in on every tap.
- A grid with no phone column now gets one that shrinks, app-wide, so sections
  no longer grow past the screen and get cut off; fields may narrow inside a
  row rather than push a button off the edge.
- Approvals' line items scroll on their own and the totals row wraps.
- The phone menu is capped to the visible screen, so Sign out stays in view.
- Phone page padding is 15px instead of 30px.
- The phone top bar stays pinned while scrolling.
- Popup ✕, the receipt viewer's × and remove-line × have larger tap targets.
- iPhones get a home-screen icon.

### 6. Add item popup is cut off on mobile, and can't be scrolled sideways

The Add item popup, the item page's offer form, the vendor pricing popup and the
item and vendor Details forms get one column on phones, and the price field may
narrow, so every field fits the screen. The unit dropdown reads "— as above —".

### 5. Vendor page: the products they supply, and adding items and pricing there

A Products section on every vendor page lists each item and pack size the
vendor supplies: price per pack, price per unit, how often it has been bought
and when last, with Approve / Reject on pending offers and rejected ones
collapsed. For Pricelist editors, "+ New item" opens Add item with the vendor
filled in, and "+ Add pricing for an existing item" searches the Pricelist,
picks a pack (packs this vendor already prices are greyed out) and takes the
price, brand and product code.

### 3. Receipt upload doesn't match items already on the Pricelist

Every goods line is now matched as soon as the receipt is read, and the form
shows what it will be filed against under each line: ✓ when certain, "Check"
when probably right, "New item" with close matches offered when nothing fits.
Quantities, packaging words and plurals are set aside, one-letter handwriting
slips still count, and a wording the vendor has used before matches outright.
The pack is read from the line ("Box Tomato", "20kg Onions") or the vendor's
history, and the form asks when neither settles it. A matched line files
against that pack and never creates an item or pack size. Against the live
Pricelist, all eleven lines of the BLF + Mix invoice find their items.

### 4. Submit typeahead shows only one of an item's pack sizes

The typeahead lists every pack of every item still in use, priced or not, and
finds items by what receipts have called them. Choosing a pack with no offer
from this vendor adds a pending one on submission.

### 2. Item setup for boxed produce: price per box and per kg, both

A pack now records what it comes in (migration 0040): loose, or a box, bag,
sack, carton, tray, punnet, bunch, bottle, jar, tin, tub or pack. The pack form
starts from "Comes as", then "Each box holds 6 kg", with smaller packs inside as
an optional tick. Green Chilli reads "Box of 6 kg" and its offer "$40.00 per box
($6.6667/kg)". "What we've actually paid" adds most recent and average per pack
beside the per-kg figures, and Reports and the dashboard unit-cost table gain a
Per pack column. "Compare prices per" is "Measured in". Existing packs named
with a packaging word are backfilled, and receipt-created packs read it off the
line.
