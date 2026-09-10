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

## Done

### 1. Pricelist: hide rejected offers from the expanded row

Rejected offers are gone from the Pricelist entirely (rows, expansions, and the
"+N more" count). An item whose every offer was rejected keeps them so it does
not vanish. Follow-up in #10.

### 2. Receipt upload: say what each step is doing

Three real steps now, each genuinely observed: preparing the photo, uploading
it, reading it. The upload and the model call are separate calls so the browser
can tell them apart.

### 3. Vendor payment details: allow adding an account when one is on file

An account is now a row with a life of its own (pending / approved /
superseded). The submit form offers "the invoice shows different details"; what
is entered is recorded beside the current account and confirmed from the vendor
page by whoever makes the transfer. Past accounts are kept. Follow-up in #11.

### 4. Item numbers: per-category numbering

Decided: real per-category counters. Chicken now starts at CHK-0001. Moving an
item renumbers it into the new category and retires the old number as a
searchable alias. Vacated numbers are not reused and gaps are not closed.

### 5. Categories: sort them in ascending order

A→Z everywhere, subcategories under their parent.

### 6. Tag categories by line type, and filter the submit page by it

Tagged goods / service / charge, seeded per category and editable under Manage
categories. It orders rather than restricts: a line's own categories come first,
everything else stays under "Other categories".

### 7. Receipt price never lands on the auto-created vendor offer

It does now, and it is the price of the whole pack rather than a per-unit
figure.

### 8. New item setup is too slow — rework pack sizes

A receipt line that states its pack ("Rice 5kg x 4") now creates that pack size
instead of the plain "one unit" shape, with the price to match. An offer still
missing a price or a vendor opens its fields rather than hiding them.

### 9. Vendor detail page: approve or reject from there too

Status and the Approve / Reject pair are on the vendor page, using the same
action the list calls.

### 10. Rejected offers: decide how they get archived or deleted

Decided: they stay as history, collapsed. An item page shows its live offers and
puts the rejected ones behind an "N rejected" disclosure, rendered by the same
code so a rejected offer keeps its actions and its history. Nothing is deleted
and nothing ages out — expense lines still point at these rows, and the existing
Delete offer button already clears a genuine mistake. A pack whose every offer
was rejected says so rather than looking empty.

### 11. Tell the Treasurer at payment time when an invoice disagreed with the account on file

Payments and the expense page now show who is being paid and on what account.
An account a submitter read off an invoice is marked unconfirmed, says whether
it disagrees with the one on file (and what that one is), and links to the
vendor page to confirm. Payments sorts unconfirmed accounts to the top and
carries the marker into the export. The numbers stay behind payments:mark_paid;
the payee's name and the unconfirmed marker do not, so a submitter can see who
their receipt will pay.

### 12. Notifications: View opens the list, not the expense

Every expense notification linked to /my-submissions or /approvals, leaving you
to find the row yourself. They point at the expense now. The card prefers the
expense_id each notification already records over its stored link, so the ones
sent before this are fixed too, without a migration. A reviewer following "New
expense to review" lands on the page that carries Approve / Reject.

### 13. Submit: look the vendor up automatically from the extracted ABN

The ABR lookup runs on its own once extraction has read an 11-digit ABN, so the
registered name is filled in without anyone pressing "Look up vendor". Only when
the vendor is not already on file, once per ABN, never while editing an existing
expense, and never over a name the submitter has typed. Silent on failure — the
button is still there to retry and to say why.

### 14. Submit: picking an item from the typeahead throws the pack size away

Honoured now. The chosen offer's id travels with the line, and the server files
the line against that offer instead of re-deriving a pack from the description
text. The pin clears the moment the description or item number is edited, and a
pin that no longer resolves falls back to matching rather than failing the
submission. Choosing a suggestion also teaches the app that this vendor's
wording means that item.
