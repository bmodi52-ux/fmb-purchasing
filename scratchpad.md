# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.

## Bugs

<!-- What happened, where, and what you expected instead. -->

## Improvements

<!-- Existing things that should work better. -->

## Ideas

### 10. Rejected offers: decide how they get archived or deleted

Fell out of #1. Rejected offers no longer show on the Pricelist, but they still
accumulate on the item page forever. Worth deciding whether they age out, get
deleted once nothing points at them, or stay as history on purpose.

### 11. Tell the Treasurer at payment time when an invoice disagreed with the account on file

Fell out of #3. A submitter's proposed account is confirmed from the vendor
page, which is fine when someone goes there — but an expense whose payee is an
unconfirmed proposal shows nothing about that on Payments or on the expense
itself. Bank details are only ever displayed on the vendor page today, so this
is really "show the payee's account where the payment is actually made".

## Done

1. **Pricelist: hide rejected offers from the expanded row** — rejected offers
   are gone from the Pricelist entirely (rows, expansions, and the "+N more"
   count). An item whose every offer was rejected keeps them so it does not
   vanish. Follow-up in #10.
2. **Receipt upload: say what each step is doing** — three real steps now, each
   genuinely observed: preparing the photo, uploading it, reading it. The upload
   and the model call are separate calls so the browser can tell them apart.
3. **Vendor payment details: allow adding an account when one is on file** — an
   account is now a row with a life of its own (pending / approved /
   superseded). The submit form offers "the invoice shows different details";
   what is entered is recorded beside the current account and confirmed from the
   vendor page by whoever makes the transfer. Past accounts are kept. Follow-up
   in #11.
4. **Item numbers: per-category numbering** — decided: real per-category
   counters. Chicken now starts at CHK-0001. Moving an item renumbers it into
   the new category and retires the old number as a searchable alias. Vacated
   numbers are not reused and gaps are not closed.
5. **Categories: sort them in ascending order** — A→Z everywhere, subcategories
   under their parent.
6. **Tag categories by line type, and filter the submit page by it** — tagged
   goods / service / charge, seeded per category and editable under Manage
   categories. It orders rather than restricts: a line's own categories come
   first, everything else stays under "Other categories".
7. **Receipt price never lands on the auto-created vendor offer** — it does now,
   and it is the price of the whole pack rather than a per-unit figure.
8. **New item setup is too slow — rework pack sizes** — a receipt line that
   states its pack ("Rice 5kg x 4") now creates that pack size instead of the
   plain "one unit" shape, with the price to match. An offer still missing a
   price or a vendor opens its fields rather than hiding them.
9. **Vendor detail page: approve or reject from there too** — status and the
   Approve / Reject pair are on the vendor page, using the same action the list
   calls.
