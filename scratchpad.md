# Scratch pad

**Next number: #49.** To see what's open, list the headings
(`grep '^### ' scratchpad.md`) and read only the item you need.

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

### 46. Old prices undercut current ones in thaali costing

Raised 2026-09-27, from Cream (thick) DRY-0002. Costing takes the cheapest
price for an item from any store, paid or quoted (#29). Campbells has two
approved offers on the same 3 × 5 L carton: $114 ($7.60/L, current) and $98
($6.53/L, the July receipt's price). Costing uses $6.53.

Checked on live the same day (read-only). The same happens elsewhere:

| Item | Costed at | Latest receipt at that store |
|---|---|---|
| Cream (thick), Campbells | $6.53/L (July) | $7.60/L on 19/09 |
| Chicken Whole, Fresh Poultry | $7.34 (August) | $9.00 on 15/09 |
| Ginger, KMA (three offers: $75, $100, $120 on one pack) | $12.50/kg | $16.67 on 15/09; $14.00 on another pack on 19/09 |

Other things found:
- A receipt never updates an offer's price: it only fills an empty one
  (`fillMissingPackPrice`, `src/lib/expense-matching.ts`). Lamb Mince at
  Foodworks is offered at $26 but was bought at $27 on 22/09.
- The receipt side of costing keeps the latest receipt per store and brand,
  not per pack size (`loadItemPrices`, `src/app/(app)/menus/data.ts`), so 12
  item/store pairs lose one pack's price whenever the other is bought.
- An offer's date comes from `updated_at`, so editing a product code makes
  an old price look new. 22 items are costed at a price 45–66 days old
  shown with a September date (same figure as their newest, so harmless
  today).
- The buying list (`src/app/(app)/procurement/data.ts`) and the Pricelist's
  collapsed row read the same offers, so they're wrong too.
- No menu had been released yet, so no wrong price was frozen into
  `menu_requirements`.

How the duplicates get in: editing an offer's pack size doesn't check the
new size already has an offer from that store (`updateOffer`,
`src/app/(app)/pricelist/actions.ts`) — this is how Cream's happened on
27/09; "Add offer" on the item page doesn't check either (`addOffer`; the
vendor-page `addVendorOffer` does); and nothing in the database stops it.

**Decided 2026-09-27:**
- **One current price per store + pack size + brand.** A database rule
  allows only one live offer for that combination. Editing a pack size or
  adding an offer where one exists refuses, or offers to merge.
- **A newer receipt updates the offer's price automatically**, logged in
  its history as coming from that receipt. Not from a line whose pack
  disagrees, a declined or withdrawn expense, or a credit line. Big jumps
  are still flagged by the price alerts. A receipt older than the offer's
  price (e.g. an old one re-matched) is recorded but never becomes current.
- **The offer records when its price was set** (a new column), used as the
  price's date instead of `updated_at`.
- Costing and the buying list then read offers only, per pack size; the
  cheapest current price across stores still wins (#29). How to treat a
  price's age is still #30.

To watch: Ginger has two KMA receipts at $2.08/kg and $8.33/kg on the same
pack, which look like misread quantities the pack check didn't catch. With
auto-update, a line like that could overwrite an offer.

Cleanup once built: merge the three duplicates above — keep one offer
each, move their receipt lines onto it, price from the latest receipt.

### 47. Releasing a menu can suggest a store from a rejected offer

Raised 2026-09-27, found while checking #46. The store suggested for each
item on release is the cheapest offer, and rejected offers aren't skipped
(`src/app/(app)/menus/release-actions.ts`, the `cheapVendors` query).
Expected: rejected offers are ignored, the same way costing and the buying
list ignore them.

### 45. A second Nimco Foods vendor was created on submit

Raised 2026-09-27. Nimco Foods was already on file. The first time, the ABN
lookup button was clicked when it was added. On a later expense the lookup
wasn't clicked, and submitting quietly created a second Nimco Foods vendor.
Nothing on the form made it noticeable. Expected: the existing vendor is
matched, or at least there's a clear warning before a new one is made.

Checked on live the same day. The ABN *was* read from the second receipt,
but wrongly:

| | V-0017 (E-0061) | V-0019 (E-0070) |
|---|---|---|
| Name | FULBECK PTY. LIMITED T/A Nimco Foods | Nimco Foods |
| ABN | 37 003 900 427 (ABR-checked) | **03** 003 900 427 (never checked) |

`matchOrCreateVendor` (`src/lib/expense-matching.ts`) tries the ABN first,
then the exact name. The misread ABN matched nothing. The name didn't match
either, because V-0017 had taken the ABR's legal name. So a new vendor was
made, and nothing checked it before submit.

**Decided 2026-09-27: the ABN check always runs, whether or not anyone clicks
the button.** That is what the ABR lookup was built for. The order when a
receipt has an ABN:
1. Is that ABN already on a vendor? If so, use that vendor.
2. If not, look it up with the ABR automatically, before the vendor can be
   created. A number the ABR doesn't know, or one that fails the checksum,
   means the ABN was misread. It gets flagged for the submitter and is never
   used to create a vendor.

03 003 900 427 fails the ABN checksum (37 003 900 427 passes), so step 2 would
have caught it. Extra safeguards to consider alongside:
- Match on the last 9 digits (the ACN part of a company ABN) when the full
  ABN doesn't match, and ask "Is this V-0017?"
- Match names loosely: ignore case, "Pty Ltd" and the like, and match either
  side of "T/A".

Cleanup: fold V-0019 into V-0017 with #44 (merge vendors), or move E-0070
across by hand.

## Improvements

<!-- Existing things that should work better. -->

### 48. Push notifications show the web address, not the system name

Raised 2026-09-27, from an Android screenshot. Each notification shows
"www.fmbpurchasin…" above its title. Wanted: the system name (Mashk)
instead.

Checked that day: Chrome adds that line to every web push notification to
show where it came from, and a site can't remove it or change it. What the
site does control:
- The group heading above the notifications, which comes from the installed
  app's name. The phone still shows "FMB Sydney", although `manifest.ts` now
  says "Mashk · FMB Sydney" / "Mashk". Chrome refreshes an installed app's name
  on its own schedule; removing the app and adding it to the home screen
  again updates it straight away.
- The title and body. "Mashk" could lead the title, e.g. "Mashk · Submitted
  E-0077", at the cost of room for the rest.

### 42. The "Add another pack size" form is always open

Raised 2026-09-27. On a price list item's page
(`src/app/(app)/pricelist/[id]/page.tsx`, fields in `pack-fields.tsx`), the
form for another pack size sits fully open below the existing sizes: Comes as,
Each pack holds, Name, the smaller-packs checkbox and "Shows as". It looks as
if the page is waiting for something to be filled in. Collapse it to a single
"+ Add pack size" button, and open the fields only when someone wants to add
a size.

### 44. Merge two vendors

Raised 2026-09-27. There is no way in the app to combine duplicate vendors.
The only vendor merge was the one-off pass in migration 0034, which grouped
vendors by ABN and then by name. Duplicates made since then, like a misspelt
name or one copy with an ABN and one without, can only be fixed in the database.

Decided that day:

- **Who:** anyone who can edit vendors, not only admins.
- **Vendor number:** the original one stays, meaning the number of whichever
  vendor was created first. That holds even when the newer record is the one
  kept, because it is the number already written on paper.
- **Undo:** yes. The merge keeps a record of which rows it moved, and Undo
  moves them back. There is no time limit. Undo is blocked once a new expense
  has been added to an offer the merge combined (the same pack sold by both
  vendors), because that expense can't be split back between the two. The
  undo button then says why it's unavailable.

Shape: follow the item merge on the Pricelist (`pricelist/[id]/merge-panel.tsx`).
On the duplicate vendor's page there would be a "Merge into…" option, a preview
of what moves, then Confirm. The repointing SQL in 0034 covers expenses,
addresses, contacts, payees, pricelist offers (combining the same pack) and item
descriptions. Every table that has pointed at vendors since then needs its own
rule too: payee account history (0037), price alerts, procurement and menus,
records, GST checks, notification rules and anything newer. Go through the
migrations for `vendor_id` when this is picked up.

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

### 33. Backups have never run

Raised 2026-09-24, from a look at what Supabase Pro would add. The backup
scripts exist (`scripts/backup-data.mjs`, `scripts/backup-receipts.mjs`) and
Backups & records is ready to show their runs, but on live `backup_runs` and
`restore_rehearsals` are both empty. No "FMB backups" task is scheduled on
this PC, and `G:/My Drive/FMB Backups` from the docs doesn't exist here.

To do: point the nightly `schtasks` line in `docs/backup-and-restore.md` at a
folder that exists (ideally one Google Drive syncs), run both scripts once by
hand, and confirm the run appears on Backups & records.

Limits of this route, which #34 addresses: it only runs while the laptop is
on; the JSON dump has no password hashes, so a restore means everyone resets
their password; and tables are read one by one, not as a single snapshot.

### 34. Nightly backups off the laptop

Raised 2026-09-24 with #33. On the Free plan Supabase keeps no backups we can
restore from, and Pro's daily backups (7 days kept) still leave out Storage.

The idea: a scheduled GitHub Actions job, like `uptime.yml`, that nightly
- runs `pg_dump` through the session pooler (the direct host is IPv6-only),
  giving one consistent snapshot with the schema and `auth.users` password
  hashes included;
- mirrors the `receipts` bucket incrementally, as `backup-receipts.mjs` does;
- stores both in cheap off-site storage (Backblaze B2 or Cloudflare R2;
  Actions artifacts only keep 90 days, too short for five-year receipts);
- records its run on Backups & records.

To decide: where the copies live, and the database password and storage keys
as repo secrets. A restore rehearsal into the sandbox should follow the first
run. Supabase Pro ($25/month) stays the option for one-click restores, or
when receipt storage nears the Free plan's 1 GB.

Items 36–41 came from the security review of 2026-09-27, done alongside the
running-costs slide. None of them costs anything.

### 36. Anyone can create an account through Supabase

Raised 2026-09-27. The app has no sign-up page, but "Allow new users to sign
up" is still on in Supabase (`disable_signup: false` on both live and the
sandbox). With the public anon key, anyone can register through the Auth API,
confirm their own address, and `handle_new_user()` puts them in the default
team: they can submit expense claims with their own bank details, and each
claim costs a receipt read.

To do: Authentication → Sign In / Providers → turn off "Allow new users to
sign up", on live and the sandbox. Adding users from Admin → Users keeps
working, because it uses `auth.admin.createUser`. Then check the 6 existing
accounts are all people we know.

### 37. The GitHub repository is public, and `main` is unprotected

Raised 2026-09-27. `bmodi52-ux/fmb-purchasing` is public, and `main` has no
branch protection or ruleset. No passwords or keys are in it (the history was
checked), but it shows anyone how the system and its access rules work, plus
test receipt details in `scripts/extraction-ground-truth.json`.

To do: make it private, and add a rule that CI (Tests, Lint, Types) must pass
before changes reach `main`.

Knock-on cost: private repositories get 2,000 free Actions minutes a month,
and `uptime.yml`, every 15 minutes, uses about 2,900 on its own (each run is
billed as a whole minute). Moving that check to a free service such as
UptimeRobot, or running it hourly, keeps GitHub at $0.

### 38. Two-factor sign-in on every service account

Raised 2026-09-27. Turn it on for Supabase, Vercel, GitHub, Crazy Domains,
Resend, Anthropic, and the Google account that will hold the backups (#33).
Those backups will contain everyone's bank details.

### 39. Protect the domain at Crazy Domains

Raised 2026-09-27. Turn on domain lock and auto-renew with a card that's still
valid, and keep the registrant contact details current. If the domain lapses,
the site goes down and email on the domain could be taken over.

### 40. Email spoofing protection

Raised 2026-09-27. The DMARC record is `v=DMARC1; p=none;`, which only
monitors. Change it to `p=quarantine` so nobody can send convincing fake
emails in the site's name asking members for payment details. If nothing
sends mail from the main domain (Resend sends from `send.`), also add
`v=spf1 -all` there.

### 41. Run the Supabase Security Advisor

Raised 2026-09-27. Run it once from the Supabase dashboard, on live and the
sandbox, and bring anything it flags back here. It's free.

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

Raised again in the security review of 2026-09-27, for admins and payers,
since they can change bank details and approve payments. Supabase's
authenticator-app sign-in is free on every plan; the work is in the app.

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

### 43. A description field on vendors?

Raised 2026-09-27. To decide whether vendors should have a description,
e.g. what they supply or anything worth knowing about them. There isn't one
at the moment: a vendor has its name, ABN, addresses, GST status and order
lead days, but no free-text field.

### 30. Old prices, without expiring them

Raised 2026-09-24 with #29. Prices never expire (decided that day), so an
old web price can make a thaali look cheaper than it is; the date is shown
beside every price. Ways to weigh later: flag rather than drop an old price
(a faint "6 months old" beside it); re-read saved links on a schedule so
prices refresh themselves; let a new receipt from the same store replace its
quote; or list the oldest prices on Needs attention to be checked.

Update 2026-09-27: a new receipt replacing its store's quote is decided in
#46. Still open: whether old prices drop out of costing or are just flagged.
Leaning towards flagging: on live that day, once #46's duplicates are
merged, no item's cost would change under an age cutoff (all 22 items
costed at a 45+ day old price had the same figure as their newest), and
dropping old prices would leave rarely bought items unpriced. Suggested:
the age beside every price, highlighted past ~60 days on costing and the
buying list, oldest listed on Needs attention.
