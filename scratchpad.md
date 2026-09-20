# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.

Numbers are written as headings rather than as a numbered list, because markdown
renumbers a list and would show #12 as 10.

What has been delivered is in [scratchpad-delivered.md](scratchpad-delivered.md),
so this file stays to what is still open. Numbers are unique across both.

## Bugs

<!-- What happened, where, and what you expected instead. -->

### 71. A wrong pack size makes "last paid" ten times too high

Found 2026-09-20 on the sandbox while checking menu costing. Ginger's last
paid price reads $100.00/kg, dated 15/09/2026. The receipt behind it says
"Ginger Box 2x10kg", $200 — ten dollars a kilo.

The offer it was matched to has no real pack behind it: one loose unit of 1.
Two of those is 2 kg, not 20, so the $200 divides by ten times too little.
The figure then travels: the 18/09 menu was planned at $625 for 6.25 kg of
ginger, and the receipt that covered it came to $62.50.

Nothing in the arithmetic is wrong — the pack is. But a price this far out
should not pass silently into a menu's planned cost. Worth deciding between
flagging a pack whose receipts disagree with it by an order of magnitude,
refusing to price from an unconfirmed pack at all, or both.

### 72. "Boxes per batch" stays on screen for a per-box recipe

Raised 2026-09-21 on Add a dish. Choosing "per box" leaves the Boxes per
batch field sitting there with 200 in it, labelled "(if per batch)" — a
field that does nothing, explaining in brackets that it does nothing.

It should go when the recipe is per box, and come back when it is per batch.
The dish page's own Details form has the same pair and the same problem.

## Improvements

<!-- Existing things that should work better. -->

### 70. Thaali costing: menus, requirements, procurement

Raised 2026-09-20, with the Google Sheet it would replace: a column per thaali
day, holding the menu and three sections — Meat, Fresh produce (Veggies),
Groceries (Rashan) — each listing quantities ("Goat 120kg", "Tomato 60kg",
"Yoghurt 80 kg"). Supersedes #43, which sketched the same ground before there
was a sheet to look at.

**What was asked for**

1. A menu against a date, on a calendar that reads in both Gregorian and
   Hijri.
2. Each dish says what goes into it; each day says how many thaalis are
   expected; from those two, the quantity of every ingredient, the cost of
   each dish and the cost of a thaali that day.
3. Ingredients grouped into Meat, Fresh produce and Dry goods, with the total
   per item for the day; lists printable per section, per day, and for several
   days at once.
4. When a day's menu is finalised and released, what it needs becomes work
   assigned to whoever procures that section, who marks each item ordered and
   then delivered.
5. The purchasing head can move a section, or single items within one, to
   somebody else.
6. A costing basis — see below.
7. The procurement list arranged by vendor, defaulting to the cheapest, with
   the vendor changeable.
8. Permissions for every new page.

**6. What price to cost at**

Three prices exist in the app already and they answer different questions:

- `item_unit_costs.latest_cost_per_base_unit` — what was last actually paid
  per kg or per litre, from submitted receipts.
- `loadCheapestRecent` — the cheapest actually paid in the last N days
  (90 by default), with the vendor it came from. This is what Buying shows.
- The vendor offers on the Pricelist — quoted prices, which may be stale.

Proposed: **cost at the most recent price actually paid per base unit**,
falling back to the cheapest recent, then to the preferred vendor's offer,
then to nothing — and say per line which of the four was used, so a figure
nobody can explain is impossible. Quoted prices are the last resort because
what was paid is a fact and a quote is an intention.

For the shopping list (7) the question is different — it is about what this
purchase will cost, not what past ones did — so there the cheapest recent
price and its vendor is the right default.

Two things that matter more than the choice:

- **Freeze it on release.** Store the price used against each line when the
  menu is released, so a day's cost doesn't quietly change months later when
  the price of onions does.
- **Then compare with what was really spent.** Expense lines already carry
  the item and the date; matching them back to the day gives planned against
  actual per day, per dish and per section. That comparison is the whole
  reason for costing at all, and it is the part the spreadsheet cannot do.

**9. What else it needs**

- **Which days are thaali days.** The calendar needs the schedule itself, and
  days with no thaali, before it can hold menus.
- **Recipes that scale, and yields.** A recipe per dish in base units for a
  stated number of thaalis, scaled by the day's count. Yield matters
  separately: 20 kg of garlic bought is not 20 kg of garlic peeled, and a
  bone-in shoulder is not all meat.
- **Pack sizes, when buying.** 36 litres of tomato purée is nine 4 L boxes.
  The app knows pack sizes, so the list should round to what is actually
  sold and say what the rounding costs.
- **What is already in the store.** Deferred 2026-09-20: everything is
  treated as bought for the day. The monthly count in #43 is what would
  change that.
- **Changing counts.** Thaali numbers move after a menu is released. What
  happens to lists already assigned, and to items already ordered, has to be
  decided rather than discovered.
- **Copying a menu.** Most menus repeat. Copying last week's, or a saved
  template, is what makes this quicker than the sheet rather than slower.
- **Ordering deadlines.** Deferred 2026-09-20: an order-by date per vendor,
  and a nudge before it, comes later.
- **Back to the receipt.** When the expense for an order is submitted, it
  should be linkable to the day and section it was for. Without that, planned
  against actual is guesswork.
- **Who is told, and when.** Assignments, released menus and late orders
  should use the notifications already built (#27, #28), including the
  reminders and escalation.
- **A record of changes.** Who changed a released menu, and when, as item and
  vendor history already do.
- **On a phone, in a shop.** The list has to be usable with one hand in a
  market: tick as bought, see the quantity, call the vendor.
- **Reporting.** Cost per thaali over time, by dish, by section; the monthly
  committee pack (#40) would carry it.

**Shape of the work**

Roughly four pieces, each useful on its own:

1. Calendar, menus, dishes, recipes, thaali count, cost per thaali (planned).
2. Requirements by section for a day or a range, with lists to print or
   download.
3. Release, assignment, ordered/delivered, reassignment by the purchasing
   head, permissions for all of it.
4. Vendor choice and pack rounding on the list, then planned against actual
   once receipts are in.

**Decided 2026-09-20**

- **Sections.** Meat and Fresh produce are fixed. Dry goods is a grouping of
  the remaining categories, edited in App settings, and a single item can be
  moved to another section as an override.
- **Dishes are a library.** A dish is saved once with its recipe, reused on
  any day, and keeps a history of the days it was made.
- **Recipes take either basis.** A recipe is written per batch of a stated
  number of thaalis (how it is done now) or per thaali, and says which. On a
  batch recipe the day's count rounds up to whole batches, and what the
  rounding adds is shown.
- **Two kitchens.** Menus, counts and costs are per kitchen. A shopping list
  can combine both — one person buys for both — while the cost stays split by
  each kitchen's planned share.
- **Copying a menu.** Any past day's menu can be copied onto any day, not
  only the most recent.
- **Thaali counts, and the RSVP tool.** A day carries a planned count, which
  is what buying is based on, and later a confirmed count. The RSVP tool is
  outside the site today and may be brought in; when it is, confirmation lands
  about two days before the day itself, so the planned count has to stand on
  its own. When the confirmed count arrives and differs, the day shows the
  difference as a top-up or a reduction against what was already ordered,
  rather than silently restating the requirement.
- **Stock on hand:** ignored for now, as asked. Everything is treated as
  bought for the day.
- **Order-by dates and vendor lead times:** later.

**Tying receipts back to days**

The hard part, because a receipt can arrive days late, be bought a day early,
or cover several days at once — so a receipt does not belong to a day, its
*lines* belong to *requirements*.

What makes this tractable is that a released menu has already said what is
needed, per item, per day, per section. So:

- **Allocation is a record of its own**, not a guess made at display time:
  expense line → menu day → quantity and amount. One line can point at
  several days; one day is fed by many lines. It is stored, so it can be
  corrected and audited, and it is what planned-against-actual reads.
- **The app proposes, on submission.** When an expense is submitted by
  somebody holding open procurement for a section, its goods lines are matched
  against the outstanding requirements for that section — the same item,
  oldest first, within a window of about a week either side. 120 kg of goat
  against a day needing 120 kg allocates cleanly; 200 kg across two days
  needing 120 and 80 splits by those quantities.
- **The submitter confirms in one place.** The submit form shows "this
  receipt covers: Friday 18 Sep — Meat" with the days ticked, and the ticks
  can be changed. It is one glance when the app has it right, which it will
  have most of the time, because the list was generated from the menu.
- **What doesn't match stays visible.** More bought than any day needs, an
  item on no list, or a receipt from someone holding no assignment, all land
  as unallocated purchases on a screen for exactly that, alongside days whose
  requirements nothing has been bought against yet. Unallocated spend still
  counts in the period totals — it is only the per-day figure it is missing
  from, and the screen says so.
- **Cost per thaali is therefore two figures**, and both are worth having:
  planned, from the prices frozen at release, and actual, from what has been
  allocated so far. The gap between them is the interesting number, and the
  day says how much of its requirement is still unbought so the actual figure
  is never mistaken for final.

Not to be started until asked.

### 76. A thaali is a set of boxes, and not everybody takes all of it

Raised 2026-09-21, filling in what #70 assumed. The app currently treats a
day as "250 thaalis" and multiplies every dish by it. That is not what a
thaali is.

A thaali is a set of dishes distributed on a day, and each part of it is
taken separately:

- **A dish is one or two boxes.** Chicken biryani might be taken as 1 × 1 L
  or 2 × 1 L; another dish as 1 × 1 L or not at all. Some parts are
  individual items rather than boxes.
- **People take part of a thaali.** Someone can skip a dish entirely, so the
  number of boxes of a dish is not the number of thaalis.
- **Roti is optional**, given with the thaali some days and not others. When
  it is on, it has to reach procurement like anything else, with its own
  person assigned to it.
- **Fruit is optional** too. It buys as Fresh produce, but on the menu it is
  its own thing, not an ingredient of a dish.

What this means for what is already built: a day needs a count per dish, not
one count for the day, and the menu needs to hold parts that are not dishes
with recipes. Cost per thaali then becomes the cost of a full thaali against
the cost of what was actually made — which is the more useful figure anyway.

**How a menu is set up** (answered 2026-09-21). The menu itself states the
box, so the counts come from setting it up rather than from anywhere else:

> **Menu A**
> Chicken biryani — 2 × 1 L box (people take 1 or 2)
> Raita — 1 × 60 ml box
>
> **Menu B**
> Gosht — 1 × 650 ml box
> Daal — 1 × 1 L box
> Rice — 1 × 1 L box
> Roti — yes/no

So a line on a menu is a dish, a box size, and how many of that box the
thaali offers. Somebody taking Menu B might take only daal and rice; somebody
else only gosht and roti. What has to be bought therefore turns on how many
people take each line, not on the day's count.

**Roti is all or nothing.** How much roti a thaali gets is set when the menu
is set up — 1, or 0.5, or 0.25. Whoever takes roti takes that amount; they
cannot ask for half of it. So the only number that varies is how many people
say yes.

(60 ml is a guess, which is exactly why box sizes are a list somebody can
edit — that part is done and on live.)

**Where the per-line count comes from** (settled 2026-09-21). Buying needs a
number against every line, not one number for the day: 250 thaalis might be
180 gosht, 240 daal, 250 rice and 120 roti, and biryani offered as 2 × 1 L
might come to 380 boxes across 250 people. The RSVP tool is outside the app
and only says how many thaalis, so the number is typed when the menu is set
up — a count beside each line, defaulting to the day's thaali count, changed
where somebody knows better ("roti, about half").

Chosen over buying for everyone on every line, which over-buys, and over
waiting for RSVP to collect per-dish choices. When RSVP does collect them,
its figures replace the typed ones and nothing else about this changes.

### 77. A simple mode that is just the sheet, typed

Raised 2026-09-21, and deliberately a step back from #70 and #76: the team
may not be ready to work the advanced way, and the app should not be the
thing holding up the move off the sheet.

Wanted: a day can be set up plainly. The menu is typed as text — no dishes,
no recipes, no box sizes — and under it the meat, fresh produce and dry goods
are listed with their quantities, typed directly, without saying which dish
they are for. That is what the Google Sheet holds today, and typing it into
the app should be enough on its own.

The point is that everything after it still works. A typed quantity is the
same requirement as a calculated one, so release, the section lists, who buys
what, ordered and delivered, the receipts allocated back — all of it should
run off a simple day exactly as it runs off a costed one. What a simple day
gives up is only the part that was derived: cost per thaali from recipes, and
quantities that move when the count does.

Which mode a day uses should be a toggle, so one day can be typed and the
next worked out, and a day can move from one to the other as the kitchen is
ready. Worth deciding whether the toggle sits on the day or on the kitchen.

### 73. Procurement dates should open on this week

Raised 2026-09-21. To buy and Shopping lists both open on an empty From/To
pair, so the first thing anybody does is type two dates.

Wanted: open on the current week, Monday to Sunday; arrows either side to
step back and forward a week; and a custom range still available for the
times a butcher's order spans a fortnight. Both pages, working the same way.

### 74. Call the Menus page what it is

Raised 2026-09-21: "Thaali Menu", or whatever reads right. The page is about
the thaali served on a day, and "Menus" on its own does not say that. The
sidebar entry, the page heading and the tab names all say Menus at the
moment.

### 75. No way to set a menu on a day that has none

Raised 2026-09-21 on the calendar. A day with a menu shows it and links to
it. A day with nothing shows nothing to click but the date number in the
corner, which does not read as a control — so the way to start a menu is to
know that the number is a link.

An empty cell wants something that says so: a plus, or "Set a menu", on
hover or always.

### 68. Filter on any column, on every list

Raised 2026-09-20 on Payments, which offers one search box ("Filter by
vendor, submitter, invoice") and a Sort by list, and nothing per column.

Expenses, Line items, Pricelist, Vendors and Users already have this: they
are built on `ColumnsDataTable`, so every heading carries a filter menu,
columns can be shown, hidden and reordered (#56), and the rows export as CSV,
Excel, PDF or JSON. The lists that have none of it are Payments, Approvals,
My submissions, Needs attention, Budgets, Accounting, Notifications,
Stand-ins, Teams & permissions, and Backups & records.

Wanted: the same filtering everywhere. Moving each list onto
`ColumnsDataTable` brings the column chooser, the saved order and the
exports with it, which is the point — one way of working on every page.

Not a single change: each list has its own row shape, its own actions
(Mark paid, Approve, Withdraw) and its own expanded rows, and some are cards
on a phone. Payments first, since it is where the money goes out and where it
was raised; then Approvals and My submissions; the admin lists last. Worth
checking as each moves that the bulk actions still work and that nothing
slows down on a long list.

### 69. Show the total of what's selected

Raised 2026-09-20 on Payments. Selecting three expenses says "3 selected"
beside Mark paid and Download bank file, but not what they come to — which is
the figure that matters before a bank transfer, and it has to be added up by
hand.

Wanted: the amount beside the count, wherever rows are selected for something
— "3 selected · $6,327.15". Payments first. The same applies to any list
whose rows carry money and offer a bulk action, so it belongs in
`ColumnsDataTable` (which shows the same "N selected") as well as in the
Payments table, ideally as one thing both use.

### 64. Check on live what has never been seen working

Raised 2026-09-20, after the run of work finished that day. Three things are
built and deployed but have only been exercised in testing:

- The loading screen's later messages: "taking longer than usual" at 8
  seconds, "something may be wrong" at 20 (#57, rewritten in #63's commit).
  Hard to trigger on purpose; they will show themselves on a bad connection.
- The warning above the lines when a scan leaves much of a receipt
  unitemised (#58).
- The second reading of a receipt whose lines fall short of its total (#58).
  Proven against the BLF & MIX photo outside the app, not inside it.

Nothing to build unless one of them misbehaves.

### 66. A PDF receipt over 3.5MB can't be submitted

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

### 67. USER_MANUAL.md and USER_MANUAL.pdf aren't in git

Raised 2026-09-20. Both sit in the working tree untracked. To decide: commit
them, or add them to `.gitignore` if they are working copies of something
kept elsewhere.

Items 18–50 came from the systems review of 2026-09-11, each with the timing
decided for it. Everything marked "now" is in Done; what remains here was
marked "later".

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

### 26. Two-factor sign-in for the accounts that move money

**When:** later.

An authenticator-app code required for anyone with Mark paid, Manage users or
Manage teams; optional for everyone else.

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

### 36. Purchase requests before spending

**When:** later.

Approval before buying, for anything over a set amount or for an event: an
estimate, the vendor, and any quotes. The expense later links to its request,
and the approver sees the estimate beside the actual. No purchase orders for
routine shopping.

### 40. Monthly committee pack by email

**When:** later.

A report emailed automatically each month to the committee.

### 43. Stock, recipes and menu costing

**When:** later. Menus, recipes and costing are now specified in #70, which
this predates; what stays here is the stock count and the shopping list.

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

## Ideas

<!-- Worth considering, not yet decided. -->

### 32. Expiry reminders for food-safety certificates and insurance

**When:** noted only — last priority.

Reminders before a supplier's food-safety certificate (meat, poultry) or a
contractor's insurance expires.

### 33. Flag contractors who don't give an ABN

**When:** noted only.

No-ABN withholding may apply when a contractor doesn't quote an ABN. Confirm
with FMB's accountant whether it does.

