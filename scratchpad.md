# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.

Numbers are written as headings rather than as a numbered list, because markdown
renumbers a list and would show #12 as 10.

## Bugs

<!-- What happened, where, and what you expected instead. -->

## Improvements

<!-- Existing things that should work better. -->

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
