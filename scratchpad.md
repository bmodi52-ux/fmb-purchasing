# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.

Numbers are written as headings rather than as a numbered list, because markdown
renumbers a list and would show #12 as 10.

## Bugs

<!-- What happened, where, and what you expected instead. -->

### 20. Approving and paying can half-fail without anyone knowing

**When:** now.

Approve, decline, reopen, mark paid and reverse payment each make two or three
separate database writes (the status change, the history row, and for payments
the payment run), and none checks whether a write failed. If one fails partway,
an expense can show Paid with no history row, or an empty PR- payment run is
left behind — and the person sees success either way. Fix: one database
function per action, as migration 0031 did for creating an expense, and an
error shown when it fails. (`approvals/actions.ts` decide and reopenExpense;
`payments/actions.ts` pay and reversePayment.)

## Improvements

<!-- Existing things that should work better. -->

Items 18–50 came from the systems review of 2026-09-11, each with the timing
decided for it.

### 18. Keep submitting, approving and paying with different people

**When:** later — a plan for down the road.

Nothing stops someone approving their own expense, or paying an expense they
submitted or approved. Plan: refuse approval of your own submission and send
it to a named alternate (e.g. the FMB Head); warn when the payer also approved.

### 19. A second person confirms any bank account change

**When:** later.

Anyone with Mark paid can put a new confirmed account straight onto a vendor,
or accept an account change they proposed themselves, and then pay into it.
Plan: new accounts always start unconfirmed; a different person confirms,
noting they called the supplier on a number already on file; payers and the
FMB Head are told whenever an account changes.

### 21. Show possible duplicates to the approver

**When:** now. May be rolled back after seeing how it goes, so it should be
easy to switch off.

The "same file" and "same invoice number" warnings only appear on the submit
form, where the submitter can carry on regardless. Show "Possible duplicate of
E-0123" on Approvals, and on Payments too.

### 22. Choose the financial year: Hijri or Australian

**When:** now. The user had this in mind too.

Everything that works by year — Reports, Budgets, All expenses, the dashboard,
exports — should work with either the Hijri year (from 1 Shawwal) or the
Australian financial year (1 July – 30 June), which the GST return uses.

Decided (2026-09-11):

- A switch on each page, not a per-person setting.
- Three kinds of year: Hijri, Australian financial year, and calendar year
  (January – December). Quarters and single months in each, plus a custom
  date range under "Advanced".
- Budgets can be set in any of the calendars and carry across seamlessly: view
  a July – June year and each Hijri year's budget contributes the part that
  falls inside it, with the rest taken from the next Hijri year.

Build plan (proposed 2026-09-11; the questions it raised were all answered):

- One period picker used on every page that works by year. Basic: the kind of
  year, which year, then whole year / quarter / month. Advanced: a custom
  from–to range, with both ends also shown in the other calendar. Presets:
  this year so far, previous year, last 12 months.
- Quarters follow the chosen year: Hijri quarters are three Hijri months;
  Australian quarters start in July, matching BAS quarters.
- The period lives in the page address, so a link, a saved view (#41) and the
  browser's back button all keep it.
- "Compare with previous period" picks the matching period in the same kind of
  year.
- Budgets are stored as a date range (start, end, amount, and which calendar
  they were entered in) instead of a Hijri year number. Any period's budget is
  the sum of the days it shares with each budget. A 365-day July – June year
  can touch three Hijri years, since a Hijri year is 354 or 355 days.
- A period partly covered by no budget says so ("133 days have no budget
  set"), rather than showing a smaller number as if it were the whole budget.
- Monthly phasing (#39), when set, replaces even spreading by day.

Decided (2026-09-11, second round):

- Every page opens on the current Hijri year, as today.
- A yearly budget is spread evenly by day unless monthly amounts are set (#39)
  — taken as agreed; the user left the suggestion unchanged.
- Overlapping budgets in different calendars: the older budget keeps the days
  it already covers, and the newer budget's total is made true by putting the
  remainder on its days that no budget covered. Both totals hold.

  Worked example (made-up dates): Hijri budget $9,000 for 1 May 2026 – 19 Apr
  2027 (354 days). Financial year 1 Jul 2026 – 30 Jun 2027 set at $10,000. The
  Hijri budget puts 293 days × $25.42 ≈ $7,449 inside the financial year; the 72
  uncovered days (20 Apr – 30 Jun 2027) get $10,000 − $7,449 ≈ $2,551. The Hijri
  year still totals $9,000, the financial year $10,000. Confirmed: the user's
  own figures were only illustrative, and the rule is that both totals hold.

- When both totals can't hold, warn and let the person override (decided
  2026-09-11, third round). This covers three cases: a new budget with no
  uncovered days (e.g. a quarter inside a budgeted Hijri year); a new budget
  smaller than what older budgets already put in its period; and an edit to an
  older budget that would push a newer budget's leftover days below zero. The
  warning names the budget already set and what will happen to it.

  Meaning of override, confirmed by the user: the budget being saved takes the days in
  dispute, and the other budget's total moves by the difference. The warning
  shows it before saving, e.g. "Hijri 1447 Meat will change from $9,000 to
  $8,400". Every override is recorded — who, when, and both amounts — in the
  budget's history (#45).

### 23. Withdraw a submission instead of deleting it

**When:** now.

Deleting a submission before a decision also deletes its history, and the
duplicate check can no longer see it. Replace it with a Withdrawn status,
hidden from the normal lists, keeping the files and the history.

### 24. Record changes to teams and permissions

**When:** now.

Who granted or removed which permission, for which team or person, and when —
shown on Teams & permissions. Today nothing is recorded.

### 25. Record which migrations each database has had

**When:** now.

Migrations are pasted into the Supabase SQL editor by hand, and nothing records
which have run. Needed before the sandbox (#1) becomes a second database: a
table of applied migrations, and a script that applies only the missing ones.

### 26. Two-factor sign-in for the accounts that move money

**When:** later.

An authenticator-app code required for anyone with Mark paid, Manage users or
Manage teams; optional for everyone else.

### 27. Reminders for things left waiting, then escalation

**When:** now, once the questions below are answered.

Notifications are in-app only, so something waiting is only seen by someone
who opens the app. A reminder goes out when something has waited too long, and
if it keeps waiting, someone else is told.

Decided (2026-09-11): the user left the design to Claude. Proposed defaults,
all changeable by an admin on a Reminders settings page:

| What is waiting | Reminded | First reminder | Escalated |
|---|---|---|---|
| Expenses to approve | Approvers | after 2 days | after 5 days |
| Approved, not yet paid | Payers | after 3 days | after 7 days |
| Bank accounts not confirmed | Payers | after 1 day | after 3 days |
| Declined, not resubmitted | The submitter | once, after 3 days | never |
| New vendors, items and packs | Pricelist approvers | weekly, Monday | never |

- One summary per person per day at 8:00am Sydney time, not a message per
  expense: "3 expenses waiting for approval, oldest 5 days".
- Sent by push or email according to each person's settings (#28), and always
  in the app. Escalations go by both push and email.
- Escalation goes to the person's active stand-in (#35) if they have one,
  otherwise to a team the admin chooses for each list (e.g. FMB Head).
- A reminder stops as soon as the thing is dealt with.
- Runs as one scheduled job a day.

### 28. Push notifications

**When:** now.

Notifications that reach a phone or computer when the app isn't open. On an
iPhone this only works once the app has been added to the home screen (iOS 16.4
or later), and each person allows it once per device.

Decided (2026-09-11):

- Each person customises their notifications: which kinds they get, turned on
  or off individually.
- Admins can create new notifications.

The app sends six kinds today: submitted (to the submitter), new expense to
review, approved, declined, paid, and system error (to admins). The reminders
in #27 and the account-change alert in #19 would add more.

Proposed build:

- A Notifications settings page: one row per kind, with a switch for each way
  it can arrive — in the app, push, email.
- Admins set the starting choices for each team, so a new Treasurer starts with
  "expense approved, ready to pay" on push without having to find the setting.
- Admins can mark a kind as required for a team (e.g. bank account changed, for
  payers), which that team's members can't turn off.

"Admins can create new notifications" means both (decided 2026-09-11):

- Announcements: an admin writes a message and sends it to everyone, chosen
  teams or chosen people ("Ashara purchasing closes Friday").
- Alert rules: an admin builds a new alert from set building blocks — when
  (expense submitted / approved / paid, vendor added, budget passes a
  percentage), only if (amount over, category, vendor, cost centre), tell whom
  (a team or a person). E.g. "When an Events expense over $1,000 is submitted,
  tell the FMB Head."

Budget-percentage and cost-centre conditions depend on #39.

### 29. Pricelist: price alerts, preferred vendors, and price list import

**When:** now.

- An alert when the price paid per kg, litre or each moves more than a set
  percentage from the last purchase. Overlaps #42 — build them together.
- A preferred vendor for each item, and a "cheapest recent source" column.
- Import a supplier's price list from a CSV or spreadsheet (#16 left this out).

Decided (2026-09-11): the alert limit is set by the user, not fixed. Proposed:

- A default percentage for the whole Pricelist (starting at 10%), with a
  separate limit for rises and for falls.
- Overridable per category and per item — meat may warrant a tighter limit
  than disposables.
- Optionally an expected price range per item ("Chicken: $6.50–$8.00 per kg"),
  alerting whenever a purchase falls outside it.

### 30. Check a vendor's GST registration

**When:** now.

The ABN lookup also says whether a business is registered for GST. Record it on
the vendor, and flag an expense where GST is charged by a vendor that isn't
registered.

### 31. Payment terms and due dates

**When:** later.

Payment terms for each vendor (e.g. 14 days), setting a due date on each
invoice.

### 34. Approval rules

**When:** later.

Who has to approve depends on amount and category — e.g. over $1,500 also needs
the FMB Head, and Events go to the events lead. The status history already
records any number of steps (migration 0001), so approvals in several steps
need no change to how history is stored.

### 35. A stand-in approver for a date range

**When:** now.

An approver names someone to approve in their place between two dates, and the
stand-in's decisions are recorded as made on their behalf.

Decided (2026-09-11): the person going away nominates their own stand-in and
the dates. Proposed details:

- Covers paying as well as approving: whoever holds either duty can nominate.
- The stand-in can be anyone with an active login; they gain only the duties
  being covered, and only between the dates.
- Admins are told, and each nomination is recorded with the permission changes
  (#24), since it is a temporary grant.
- Once #18 is built, a stand-in still can't approve their own expense.

### 36. Purchase requests before spending

**When:** later.

Approval before buying, for anything over a set amount or for an event: an
estimate, the vendor, and any quotes. The expense later links to its request,
and the approver sees the estimate beside the actual. No purchase orders for
routine shopping.

### 37. Payments: bank file, remittance, and statement matching

**When:** now.

- An ABA file from a payment run, to upload to the bank's batch payments.
- An email to the payee listing what a payment covered.
- Import a bank statement CSV to confirm the money left, matched by reference.
- A list of approved but unpaid expenses — ordered by approval date until
  payment terms (#31) give each one a due date.

Decided (2026-09-11): assume FMB's bank accepts batch payment (ABA) files.
The file's header usually needs FMB's own bank details and a user ID number
the bank issues for batch payments, so a settings page will ask for those.

### 38. Accounting: account codes, GST summary, and a Xero integration plan

**When:** now. Integration with Xero to be planned.

- An account and a tax code for each category.
- A GST summary for the chosen financial year (#22): GST on purchases, capital
  purchases and other purchases.
- A flag on GST claimed over $82.50 (incl. GST) without a valid tax invoice.
- Lock a period once its GST return is lodged; later corrections go in as
  adjustments.
- Plan the Xero integration: an import file first, or straight to syncing;
  what goes across (approved or paid expenses) and when; how categories map to
  Xero accounts.

Confirm the tax points with FMB's accountant before building on them.

Decided (2026-09-11): FMB already uses Xero.

Open questions:

- The chart of accounts: a CSV export from Xero (Accounting → Chart of
  accounts → Export) would settle how categories map to accounts.
- How purchases reach Xero today: entered as bills and then paid, recorded as
  "spend money" straight against the bank account, or bank-feed transactions
  coded as they come in? This decides what the app sends.
- Does FMB account for GST on a cash or accrual basis? This decides whether an
  expense counts when it's approved or when it's paid.
- Who holds Xero admin access, to approve connecting the app later?

### 39. Budgets and cost centres

**When:** now.

- A cost centre or event on each expense (daily kitchen, Ashara, Ramadan,
  maintenance, committees), each with its own budgets.
- The budget position shown on the approval row ("Meat: 82% used, this takes it
  to 86%").
- Submitted and approved-but-unpaid expenses counted as committed.
- Alerts at 80% and 100%.
- Optional monthly phasing, since Ramadan spend isn't spread evenly.

Open questions, to be answered later by the user: the list of cost centres and
events; is it set per expense or per line?

### 40. Monthly committee pack by email

**When:** later.

A report emailed automatically each month to the committee.

### 41. Saved report views

**When:** now.

Save a report's filters and period under a name ("Meat, this year, by vendor")
and open it again later.

Decided (2026-09-11): views can be shared. Proposed: whoever saves a view
chooses to keep it to themselves or share it with everyone who can see
Reports, or with chosen teams. Others open it or copy it; only its owner can
change or delete it.

### 42. Flag unusual spend and price jumps

**When:** now.

Flag when a vendor's spend or an item's price is well above its usual level.
Overlaps #29's price alert — build them together.

### 43. Stock, recipes and menu costing

**When:** later.

- A thaali count per day, entered by hand (the RSVP tool stays separate), giving
  cost per thaali.
- Recipes with ingredient quantities, costed from what has actually been paid.
- A menu calendar that produces a shopping list per vendor.
- A monthly count of high-value stock (meat, rice, oil, ghee).

### 44. Security and access

**When:** later.

- ITS OneLogin sign-in.
- A quarterly "who holds what" review.
- Restricted database access for pages that only read.

Two-factor sign-in is #26.

### 45. Audit trail and records

**When:** now.

- A history of changes to vendor records (permissions are #24).
- Scheduled backups of receipt files, which Supabase's point-in-time recovery
  doesn't cover.
- A record of when a restore was last rehearsed.
- No receipt under five years old can be deleted.

### 46. Engineering and reliability

**When:** now, depending on workload.

- End-to-end tests of submit → approve → pay.
- An uptime check, and an alert when a new error is logged.

The sandbox is #1; the migration record is #25.

### 47. Offline receipt capture

**When:** now.

Take a receipt photo with no signal; it is kept on the phone and uploads once
back online. Push notifications are #28.

### 48. Show GST under category and item filters

**When:** now.

Reports hide GST whenever a category or item filter is on, because the code
still assumes GST is only recorded per expense. Every line has carried its own
GST since migration 0026. Load it and show GST under every filter, marking
lines from before 0026 as apportioned. (`reports/aggregate.ts:178`)

### 49. Receipt capture: forwarding address, supplier defaults, quality checks

**When:** now.

- An email address receipts can be forwarded to, creating a draft for the
  sender.
- Defaults per supplier: usual category, who gets paid, GST treatment.
- Re-run the receipt-reading test set on a schedule, to catch it getting worse
  when the AI model changes.
- Warn about a blurry photo, or one with the total cut off, before upload.

### 50. Check the lines' GST against the receipt

**When:** now.

- Flag, to the approver, when the GST on the lines doesn't add up to the GST
  printed on the receipt.
- Mark equipment lines as capital purchases, which the GST return reports
  separately.

## Ideas

<!-- Worth considering, not yet decided. -->

### 1. Sandbox environment for training and testing

A place where new users can be trained and play around without touching real
data. Needs a decision on the approach — a separate Supabase project and Vercel
deployment (e.g. sandbox.fmbpurchasing.com.au) with its own seeded demo data,
emails that never reach real vendors or approvers, a clear "Sandbox" banner, and
a way to reset it to a clean state.

Parked until later; not to be started until asked.

Decided (2026-09-10):

- Address: sandbox.fmbpurchasing.com.au — a subdomain, so no new domain to buy.
- Database: delete the old Tokyo project and create a fresh Sydney project named
  "FMB Sandbox".
- Tokyo: deleted as it is, no export first.
- Data: a scrubbed copy of real data, with vendor names, bank details and
  people replaced. A fresh copy is taken at every reset.
- Receipt files: copied in too. Accepted knowingly: the real details printed on
  them (vendor, ABN, sometimes bank details) stay visible to trainees.
- Email: sent the same way as the live site, with subjects prefixed "[Sandbox]".
- Logins: a personal login for each trainee, kept across resets.
- Receipt reading: the same Anthropic key as live.
- Updates: the sandbox gets every change automatically when it is merged.
- Reset: a script run from this computer, for now. An admin button in the
  sandbox may come later. Its drawbacks: the sandbox would hold a key to the
  live database; a mix-up in its settings could wipe live; a big copy may
  outrun Vercel's time limit; and a reset can be clicked mid-session. The middle
  ground is a button that starts a GitHub Action, which keeps the live key out
  of the sandbox.

### 32. Expiry reminders for food-safety certificates and insurance

**When:** noted only — last priority.

Reminders before a supplier's food-safety certificate (meat, poultry) or a
contractor's insurance expires.

### 33. Flag contractors who don't give an ABN

**When:** noted only.

No-ABN withholding may apply when a contractor doesn't quote an ABN. Confirm
with FMB's accountant whether it does.

## Done

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
