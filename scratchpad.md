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
