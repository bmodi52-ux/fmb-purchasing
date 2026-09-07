# Scratch pad

A running list of everything raised, grouped by category. Numbers are assigned in
the order items came up and never change, so #2 stays #2 wherever it sits.
Nothing here is being worked on until you say so.

## Bugs

### 1. Pricelist: hide rejected offers from the expanded row

Expanding a pricelist row lists every offer including rejected ones (e.g. GRO-0002
Rice shows "Loose (per kg) — GLOBAL BEST FOODS — — rejected"). Filter them out of
the expanded panel in items-table.tsx:225 — the main page should only show live
offers. Separately, work out how rejected offers get deleted or archived properly
so they stop accumulating; the full item page can keep showing them.

### 7. Receipt price never lands on the auto-created vendor offer

A receipt that creates a new item also creates its pack size and vendor offer,
but the offer is inserted with only vendor_id, pack_size_id and status —
pack_price is left null (expense-matching.ts:531). The price was right there on
the receipt line, so "Price for the whole pack" opens empty and has to be typed
in by hand on every new item. Carry the line's price through (and the brand and
vendor SKU where the extraction has them).

## Improvements

### 8. New item setup is too slow — rework pack sizes

Every new item means redoing the whole pack-size and vendor-offer setup by
hand, which is the opposite of what this site is for. Contributing causes:
matchOrCreatePackSize always makes the plain "one unit" shape and leaves the
real pack shape to a human (expense-matching.ts:~490), the price doesn't carry
over (#7), and the item page makes you expand Edit and fill vendor, brand, SKU,
price and comments one field at a time.

Wanted: a new item should arrive from a receipt already usable — pack size,
vendor, and price filled from what was read, needing a confirm rather than a
re-entry. Worth rethinking whether the pack size needs setting up at all for
loose/per-kg items, and whether the pending offer can just be approved inline
without opening the edit form.

### 2. Receipt upload: say what each step is doing

Today the wait shows "Preparing photo…" then a single "Reading receipt…" for the
whole ten-to-twenty second extraction (submit-form.tsx:530). Break it into the
real stages — compressing, uploading, reading the text, matching items to the
price list, filling the form — so it's clear something is still happening and
roughly how far along it is.

### 3. Vendor payment details: allow adding an account when one is on file

When "pay this vendor" is chosen and bank details exist, the picker just says
they're on file and offers no fields (payee-picker.tsx:151). Good default, but
add a way to enter new details when a vendor's account has changed — an "Update
payment details" link that reveals the same BSB/account fields.

Decided: nothing gets overwritten. New details are added as another set of
details under the same vendor, so a vendor can carry more than one account and
the older ones stay visible. This fits vendors/[id]/actions.ts:117, which already
refuses to overwrite an account on file — the storage needs to go from one
account per vendor to a list, with the current one marked.

### 5. Categories: sort them in ascending order

The category list is in insertion order today — everything reads off
categories.sort_order (submit/page.tsx:25, pricelist/categories/page.tsx:27,
budgets/page.tsx:47, pricelist/[id]/page.tsx:70), and the seed order is what
shows. So Nuts & Dryfoods sits near the bottom after Professional & Contractor
Services, and Lamb comes after Chicken. Sort ascending by name — parents and
their children — so the same order shows on the submit-an-expense page.

### 9. Vendor detail page: approve or reject from there too

Approving a pending vendor only works from the list — vendors-table.tsx:59 shows
the buttons on a pending row and calls reviewVendor (vendors/actions.ts:120).
Open the vendor itself and there's nothing: vendors/[id]/page.tsx shows details,
addresses, contacts and payment fields but never the status or a decision. So
reviewing means going back to the list and acting on a row you can't fully see.

Wanted: show the vendor's status on the detail page and, when it's pending and
the viewer can approve, the same Approve / Reject pair — reusing reviewVendor
rather than a second code path.

## Ideas

### 4. Item numbers: decide whether each category should count from 001

The first item filed under Chicken reads CHK-0003, not CHK-0001. Working as
designed: the tail is the item's global item_seq, not a per-category counter
(0024_category_item_numbers.sql:7). Chicken Thigh was the 3rd item ever created,
so it holds 3 forever, and moving it to Beef would just make it BEF-0003.

The upside of the current design is that reclassifying can never collide, so
nothing ever needs renumbering. The cost is gappy numbers within a category —
CHK-0003, CHK-0117, CHK-0203.

To decide: live with the gaps, or switch to per-category counters and take on
collision handling, a reservation story, and renumbering on every reclassify.
Third option — keep the global seq as the real key and only display a
per-category ordinal.

### 6. Tag categories by line type, and filter the submit page by it

A line already carries a kind — goods, service, and the charge kinds
(line-kinds.ts:35) — but the category dropdown offers every category whatever
the kind is. Tag each category with the type(s) it belongs to, then on the
submit page show only the relevant ones: goods lines see Groceries, Meat &
Poultry, Produce and so on; service lines see Professional & Contractor
Services, Maintenance & Repairs, Transport & Logistics. Needs a decision on
categories that legitimately serve both, and a fallback so an untagged category
never disappears from the picker.

## Done

<!-- Items move here once shipped, with the PR number. -->
