# Scratch pad

A running list of ideas and bug reports, grouped by category. Recording an item
here is not a go-ahead: nothing on this pad is worked on until it is explicitly
picked up.

Numbers are assigned in the order items came up and never change, so #2 stays
#2 wherever it sits. They are written as headings rather than as a numbered
list, because markdown renumbers a list and would show #12 as 10.

What has been delivered moves to [scratchpad-delivered.md](scratchpad-delivered.md),
so this file stays to what is still open. Numbers are unique across both.

This pad was restarted on 2026-09-23. Items still open then were carried over
and renumbered from #1 in their original order; each notes its old number.
"Old #N" means a number from before the restart. The earlier pad and its
delivered list are in [scratchpad-archive/](scratchpad-archive/).

## Bugs

<!-- What happened, where, and what you expected instead. -->

## Improvements

<!-- Existing things that should work better. -->

### 12. Check on live what has never been seen working

_Was #64._

Raised 2026-09-20, after the run of work finished that day. Three things are
built and deployed but have only been exercised in testing:

- The loading screen's later messages: "taking longer than usual" at 8
  seconds, "something may be wrong" at 20 (old #57, rewritten in old #63's commit).
  Hard to trigger on purpose; they will show themselves on a bad connection.
- The warning above the lines when a scan leaves much of a receipt
  unitemised (old #58).
- The second reading of a receipt whose lines fall short of its total (old #58).
  Proven against the BLF & MIX photo outside the app, not inside it.

Nothing to build unless one of them misbehaves.

### 13. A PDF receipt over 3.5MB can't be submitted

_Was #66._

Raised 2026-09-20, from the notes on receipt uploads. Server actions cap what
a request body may carry (`4mb` in `next.config.ts`, with the host's own
ceiling above it), and the form refuses anything over 3.5MB. Phone photos are
shrunk to 2000px before they are sent, so they are never the problem; PDFs
can't be shrunk in the browser, so a large or multi-page PDF is refused with
nothing the submitter can do about it.

The fix: a server action mints a signed upload URL, the browser sends the
file straight to Supabase storage, and only the path is passed on for
reading. A moderate rewrite of `src/app/(app)/submit/`, not a quick change.

Worth doing when somebody actually hits it. The old reason for it — a slow
Washington-to-Sydney hop — stopped applying on 2026-09-05, when the functions
were pinned to `syd1` beside the database.

### 14. USER_MANUAL.md and USER_MANUAL.pdf aren't in git

_Was #67._

Raised 2026-09-20. Both sit in the working tree untracked. To decide: commit
them, or add them to `.gitignore` if they are working copies of something
kept elsewhere.

Items 18–50 came from the systems review of 2026-09-11, each with the timing
decided for it. Everything marked "now" is in Done; what remains here was
marked "later".

### 1. Keep submitting, approving and paying with different people

_Was #18._

**When:** later — a plan for down the road.

Nothing stops someone approving their own expense, or paying an expense they
submitted or approved. Plan: refuse approval of your own submission and send
it to a named alternate (e.g. the FMB Head); warn when the payer also approved.

### 2. A second person confirms any bank account change

_Was #19._

**When:** later.

Anyone with Mark paid can put a new confirmed account straight onto a vendor,
or accept an account change they proposed themselves, and then pay into it.
Plan: new accounts always start unconfirmed; a different person confirms,
noting they called the supplier on a number already on file; payers and the
FMB Head are told whenever an account changes.

### 3. Two-factor sign-in for the accounts that move money

_Was #26._

**When:** later.

An authenticator-app code required for anyone with Mark paid, Manage users or
Manage teams; optional for everyone else.

### 4. Payment terms and due dates

_Was #31._

**When:** later.

Payment terms for each vendor (e.g. 14 days), setting a due date on each
invoice.

### 7. Approval rules

_Was #34._

**When:** later.

Who has to approve depends on amount and category — e.g. over $1,500 also needs
the FMB Head, and Events go to the events lead. The status history already
records any number of steps (migration 0001), so approvals in several steps
need no change to how history is stored.

### 8. Purchase requests before spending

_Was #36._

**When:** later.

Approval before buying, for anything over a set amount or for an event: an
estimate, the vendor, and any quotes. The expense later links to its request,
and the approver sees the estimate beside the actual. No purchase orders for
routine shopping.

### 9. Monthly committee pack by email

_Was #40._

**When:** later.

A report emailed automatically each month to the committee.

### 11. Security and access

_Was #44._

**When:** later.

- ITS OneLogin sign-in.
- A quarterly "who holds what" review.
- Restricted database access for pages that only read.

Two-factor sign-in is #3.

## Ideas

<!-- Worth considering, not yet decided. -->

### 29. Add items and prices from a link

Raised 2026-09-24. Paste a product page link (or share it from a phone) and
the app reads the product, matches it to an existing item or proposes a new
one, and adds the price as that vendor's offer — the same review screen as
Add item by photo, which a link would join as a third source beside photos
and price-list files.

Suggested shape:
- Read the page's structured product data first (the schema.org Product
  block most shops publish: name, brand, price, GTIN, pack), then its text,
  then fall back to asking for a screenshot when a site blocks reading.
- Vendor from the domain, matched to a vendor whose website is on file.
- A category page gives many products, capped like price-list files.
- The link and the date read are kept on the offer.
- **Cheapest wins (decided 2026-09-24).** The point of collecting prices from
  several stores is to buy at the cheapest, so costing and the buying list
  both use the cheapest price available — paid or quoted, from any store —
  even for something never bought. Today costing prefers last paid, then
  cheapest paid lately, and only uses a quote when nothing was ever paid
  (`loadItemPrices` / `pickPrice` in menu-costing); the buying list picks
  the pack that overbuys least and ignores price and store
  (`suggestPacks`). Both change:
  - Costing: cheapest per base unit across every store's offer and what
    was last paid at each store, labelled with where it is from ("cheapest: Costco, quoted
    12/09").
  - Buying list: for each line, the store and pack that cost least for the
    quantity needed (a dearer-per-kg small pack can still win when a big
    one would be mostly waste), with the store shown so the list can be
    split by where to buy.
  - No expiry: a price counts until it is replaced, however old. The date it
    was read or paid is shown beside it ("cheapest: Costco, quoted 12/09"),
    so an old price is visible rather than hidden.
- **To come back to: old prices.** An old web price can make a thaali look
  cheaper than it is. Expiring prices was proposed and turned down
  (2026-09-24). Other ways, to weigh later: flag rather than drop an old
  price (a faint "6 months old" beside it); re-read saved links on a
  schedule so prices refresh themselves; let a new receipt from the same
  store replace its quote; or list the oldest prices on Needs attention to
  be checked.
- Later: "Check again" on an offer, and optionally a weekly re-read of saved
  links feeding price alerts.
- Server-side fetch of http(s) only, no private addresses, with a timeout
  and a size cap.

**Shops (decided 2026-09-24):** mostly Woolworths, Coles and Costco — the
hardest to read, since their pages load the price after opening and often
block anything that isn't a person's browser. So this is built as "paste a
link; if it can't be read, share a screenshot", and the screenshot path is
made smooth first: one tap from the failed link to the photo reader, with
the link kept on the offer either way. Before building, try a real product
link from each of the three and note which read and which don't.

**Sale and regular price (decided 2026-09-24):** both are kept on the offer,
with the sale's end date, and the app picks by date so nobody updates
anything. While the sale runs the buying list uses the sale price ("on
special until 30/09"); after it, the regular price is already there.
Costing always uses the regular price, showing the special beside it. This
isn't expiry: the regular price never lapses, only the sale does, on the
shop's own date. With no end date on the page: Woolworths and Coles run
Wednesday to Tuesday, so the next Tuesday; Costco prints one; anywhere else
7 days, marked "end date assumed". Reading the link or a screenshot again
replaces both; a page with one price has no sale.

**GST (decided 2026-09-24): never assumed.** Prices are stored including GST,
like receipts. A page that says "inc. GST", "ex GST" or "+GST" is taken at
its word (an ex-GST taxable price gets 10% added, marked "+GST added"). A
page or screenshot that doesn't say leaves a required choice on the review
screen — includes GST / excludes GST / GST-free item — and nothing saves
until it is made. Whether an item is taxable comes from its receipt lines'
GST treatment; an item never on a receipt is asked too. A shop's last answer
is pre-selected next time, still shown and confirmed.

**Brand (decided 2026-09-24): any brand by default, a preferred brand per
item where it matters.** With none set, the cheapest of any brand counts.
Set one (Rice → Tilda) and costing and the buying list consider only that
brand, still at the cheapest store; the list names both ("Tilda Basmati
10kg — Costco, $32.99"). A preference per dish (Tilda only for biryani)
is left for later, if the per-item one proves too blunt.

No open questions left; ready to build when picked up.
