# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.

Numbers are written as headings rather than as a numbered list, because markdown
renumbers a list and would show #12 as 10.

What has been delivered is in [scratchpad-delivered.md](scratchpad-delivered.md),
so this file stays to what is still open. Numbers are unique across both.

## Bugs

<!-- What happened, where, and what you expected instead. -->

None outstanding.

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
- **What is already in the store.** The sheet assumes everything is bought
  fresh. Subtracting what is on hand is what stops the same 20 kg of rice
  being bought twice — and needs the monthly count #43 described.
- **Changing counts.** Thaali numbers move after a menu is released. What
  happens to lists already assigned, and to items already ordered, has to be
  decided rather than discovered.
- **Copying a menu.** Most menus repeat. Copying last week's, or a saved
  template, is what makes this quicker than the sheet rather than slower.
- **Ordering deadlines.** A vendor needs a day's notice; a released menu that
  arrives too late to order is no use. Worth an order-by date per vendor and
  a nudge before it.
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

**To decide before any of it is built**

- Are the three sections fixed, or a grouping of the existing categories that
  can be changed in App settings? (Grouping is the flexible answer: Meat &
  Poultry → Meat, Produce → Fresh produce, Groceries and Daals → Dry goods.)
- Are dishes reused across days with one recipe each, or is a menu typed
  fresh every time? The sheet implies reuse ("Thaali- Bhuna gosht with roti").
- Is a recipe written per thaali, or per batch of a stated size? Cooks think
  in batches; the arithmetic prefers per thaali.
- Is there one kitchen, or several to plan separately?
- Does the count of thaalis come from the RSVP tool eventually, or stay typed
  in? #43 assumed typed, and the RSVP tool stays separate.

Not to be started until asked.

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

