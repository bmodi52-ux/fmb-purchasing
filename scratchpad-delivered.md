# Scratch pad: delivered

Everything raised and finished, newest first, kept out of the scratch pad so
that what is still open stays readable. Numbers never change and are unique
across both files — see scratchpad.md.

Delivered items from before the 2026-09-23 restart are in
[scratchpad-archive/delivered-to-2026-09-23.md](scratchpad-archive/delivered-to-2026-09-23.md).

## Delivered

### 29. Add items and prices from a link

Raised and delivered 2026-09-24 (PR #89, migration 0076). Add item by photo
became Add item by photo or link: a shop's product page reads into the same
review screen, the store is recognised by its website, and the link and date
read are kept on the price. A page with no price for its product (Costco)
falls back to a screenshot, which keeps the link.

Decisions built in: the cheapest price wins in costing and the buying list
(any store, paid or quoted, even never bought); prices never expire, the
date is shown; a special keeps both prices and switches by its end date (the
next Tuesday at Woolworths and Coles, a week elsewhere, when not shown);
GST is always asked, never assumed; a preferred brand per item. Shopping
lists show the cheapest store and can be grouped by it. Old prices are left
for #30.

### 22. Receipt reading failing, and the error shown raw in notifications

Raised and delivered 2026-09-24 (PR #88). The failure itself — the
extraction schema at 19 union-typed parameters against the API's 16 — was
fixed on 22/09 in 85a6df1; no receipt-reading errors since. What PR #88
added: failure notices say what broke in words ("Reading a receipt
failed") with the raw error left on System errors, and a test fails the
build if the receipt schema goes past 16. The 7 error records from 22/09
were marked resolved on live.

### 23–28. Design and UI overhaul

Raised and delivered 2026-09-24 (PR #87), from a design review of the whole
app. Nothing changed what the app does.

- **#23 Shared building blocks:** one set of button styles, one status
  badge, solid cards, one tab style (scrolls on a phone), one toggle;
  figures in Inter with tabular numbers rather than monospace.
- **#24 Add-menu page:** builder on the left, an estimate held in view on
  the right with Put it on days / Save / Discard, a bottom bar on a phone;
  dishes and items picked by typing. A day's menu page uses the same layout.
- **#25 Sidebar:** grouped, Admin folded, scrolls on its own; notifications
  as a bell.
- **#26 Tables and intros:** one Export menu, sort and filter marks on
  hover, filters behind a button on a phone, one-line page intros.
- **#27 Phone cards:** four fields, the rest behind "more".
- **#28 Home:** a Today panel of what is waiting on you.

Also: the sign-in logo out of the card, much larger, above it. A maroon
split sign-in panel was tried and dropped.

### 10. Stock, recipes and menu costing

_Was #43._ Delivered 2026-09-24 (PR #86). The last open part was a monthly
count of high-value stock; the rest had been covered by #15. Procurement →
Stock count keeps a list of items worth counting; a count per item per date,
in any unit, is corrected by counting again on the same date. The last six
counts sit side by side with the change since the last one and what it is
worth at what was last paid. A record only: the lists still treat everything
as bought for the day. Migration 0075.

### 15. Thaali costing: menus, requirements, procurement

_Was #70._ The four main pieces were delivered by 2026-09-21. What was still
open was delivered 2026-09-24 (PR #85):

- **Who is told:** a Thaali buying notification when a release or a handover
  gives someone something to buy, and a morning summary of anything that
  should be ordered by now (unowned lines go to whoever runs procurement).
- **Ordering deadlines:** a vendor's "order ahead (days)", blank meaning the
  day before. Each line says when to order by. This had been deferred on
  2026-09-20; it was built when #15 was picked up as a whole.
- **On a phone:** the vendor and a Call button on each line, and the next
  step as the big button.
- **A record of changes:** History on each day, flagging changes made after
  release. It survives the day being deleted.
- **Reporting:** a Costs tab showing cost per thaali, planned against spent,
  by day, section and dish.

Still ignored on purpose: what is already in the store. Migrations 0073 and
0074.

### 21. Remove a dish from a day's menu, and delete a whole menu

Delivered 2026-09-24 (PR #83). "remove" is now a bordered Remove button on
dishes, roti and typed lines. **Delete this menu** at the foot of a day,
behind a confirmation, clears that kitchen's day and any lists nobody has
bought against. A day with anything ordered, delivered or allocated from a
receipt can't be deleted, and says why.

### 20. An "Add menu" button that sets one menu on one or more days

Delivered 2026-09-24 (PR #84), with #17. "+ Add menu" on the calendar opens a
menu builder, which can put the menu on any number of days, in one kitchen
or both. Days that already have a menu are left, added to or replaced, as
chosen; a day somebody has bought for is never replaced. A released day that
changes goes back to draft.

### 19. Rename "Thaali menu" to "Thaali Calendar"

Delivered 2026-09-23 (PR #82). The sidebar, headings, tab titles, back links,
settings, and the stored page label (0071). The tabs keep their names.

### 18. Nine menu tables have no Row-Level Security, on live and sandbox

Delivered 2026-09-23 (PR #80). RLS on the nine tables (0069); checked from
outside with the anon key on both projects. PR #80 left
`LEDGERED_MIGRATIONS` short and broke CI on main until PR #81.

### 17. Estimates for a menu or dish, saved menus and favourites

Delivered 2026-09-24 (PR #84). A saved menu is a menu apart from any day,
estimated at its own thaali count. It can be named, starred as a favourite,
and put on days (#20). An unsaved one is cleared after a week. Dish pages
start an estimate for one dish; a day can use a saved menu or be saved as
one. Migration 0072.

### 16. Rejecting an item leaves its offers pending

_Was #78._ Delivered 2026-09-23 (PR #81). Rejecting an item rejects its
pending offers; approved ones are left alone. 0070 tidied the items rejected
before this (on live, DRY-0006's offer).
