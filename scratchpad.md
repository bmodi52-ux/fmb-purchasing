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
