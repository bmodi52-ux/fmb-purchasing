# Item numbering: category prefixes, plus a data cleanup

Status: proposed. Targets migration `0024` (numbering) and a separate,
one-off cleanup script.

## 0. The collision question, answered first

> What if `BEF-0042` already exists?

It cannot. `items.item_seq` is a **single global identity sequence**, not a
per-category counter. Exactly one item in the whole table ever holds seq 42,
and it holds it forever. So `BEF-0042` can only exist if some item has
`item_seq = 42` — and that item *is* the row you just reclassified. The row
that becomes `BEF-0042` is the same row that was `CHK-0042`.

Put another way: the numeric tail is already globally unique on its own. The
prefix carries **no uniqueness burden at all** — it is decoration over an
identity that was unique before the prefix was attached and stays unique after.

This is precisely the property the alternative design lacks. With a
per-category counter, `0042` means "the 42nd chicken item", Beef has a 42nd
item too, and reclassification collides on contact. That design is the one
that forces you to build manual renumbering, collision detection, and a
"who holds 0042" reservation story. This plan avoids all of it.

The same argument covers retired aliases: a retired `CHK-0042` can never
collide with a live `CHK-0042` belonging to a *different* item, because the
tail pins the item. Round-tripping a category (Chicken -> Beef -> Chicken)
just re-derives a number this item already owned.

The only way to reintroduce collisions is manual overrides — see §6.

## 1. Current state

| Fact | Where |
| --- | --- |
| `item_number` is `generated always as ('I-' \|\| lpad(item_seq,4,'0')) stored` | `0007_item_hierarchy.sql:32` |
| Backed by `item_seq int generated always as identity` | `0007_item_hierarchy.sql:31` |
| Unique constraint `items_item_number_key` | `0007_item_hierarchy.sql:33` |
| Reclassification already works, is permission-gated, and is audited | `pricelist/actions.ts:318` (`ITEM_TRACKED_FIELDS`), writes `item_history` |
| Same numbering pattern for vendors (`V-0001`) and expenses (`E-0001`) | `0015_expense_number.sql` |
| `categories` has `parent_category_id`; items are assigned to **leaf** categories only | `0008_category_hierarchy.sql`, `lib/categories.ts` |
| Categories have **no** create/edit UI today — seeded by migration/script only | `0004_categories.sql`, `scripts/seed-categories.mjs` |

**The load-bearing fact:** nothing joins on `item_number`. Expense line items
reference offer UUIDs (`expense_line_items.pricelist_item_id`). `item_number`
is only displayed, searched (`item_number.ilike`), and exported. Renumbering
is therefore cosmetic and carries no referential risk.

## 2. Target design

1. Categories get a short, stable, admin-owned `code` (`CHK`, `BEF`, `PRD`).
2. `item_number` becomes `<CODE>-<NNNN>` where `NNNN` is the item's existing
   permanent `item_seq`, maintained by trigger rather than `generated always`
   (the value now depends on a joined table, which a generated column cannot).
3. Prefix resolution falls back: **leaf code -> parent code -> `I`**. Code only
   the top-level categories and every child still gets a sensible prefix;
   uncategorised items keep reading `I-0042` exactly as they do now.
4. Every superseded number is kept as a searchable alias, so a printed sheet
   or exported CSV quoting `I-0042` still resolves. This mirrors the existing
   `vendor_item_descriptions` treatment of renamed items
   (`pricelist/actions.ts:361`) — same problem, same shape of answer.

Numbers within a category will look gappy (`CHK-0042`, `CHK-0117`,
`CHK-0203`). That is the deliberate trade for never renumbering anything.

## 3. Migration `0024_category_item_numbers.sql`

### 3.1 Category codes

```sql
alter table categories add column code text;

alter table categories add constraint categories_code_format
  check (code is null or code ~ '^[A-Z][A-Z0-9]{1,5}$');

-- partial: many categories may sit uncoded, and NULLs must not collide
create unique index categories_code_key on categories (code) where code is not null;
```

Proposed seed (adjust to taste — names as per `0004`/`0008`):

| Category | Code | Category | Code |
| --- | --- | --- | --- |
| Groceries & Provisions | `GRO` | Gas & Fuel | `GAS` |
| Meat & Poultry | `MEA` | Maintenance & Repairs | `MNT` |
| — Mutton | `MUT` | Events & Venue | `EVT` |
| — Beef | `BEF` | Transport & Logistics | `TRN` |
| — Chicken | `CHK` | Stationery & Printing | `STN` |
| Produce (Fruit & Vegetables) | `PRD` | Professional & Contractor Services | `PRO` |
| Dairy & Eggs | `DRY` | Miscellaneous | `MSC` |
| Bakery | `BAK` | | |
| Beverages | `BEV` | | |
| Disposables & Packaging | `DIS` | | |
| Cleaning & Sanitation | `CLN` | | |
| Kitchen Equipment & Utensils | `KIT` | | |

### 3.2 Number derivation

```sql
create or replace function item_number_for(p_category_id uuid, p_seq int)
returns text language sql stable as $$
  select coalesce(
    (select coalesce(c.code, p.code)
       from categories c
       left join categories p on p.id = c.parent_category_id
      where c.id = p_category_id),
    'I'
  ) || '-' || lpad(p_seq::text, 4, '0');
$$;
```

### 3.3 Alias table

```sql
create table item_number_aliases (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items (id) on delete cascade,
  item_number text not null,
  retired_at  timestamptz not null default now()
);

create unique index item_number_aliases_unique_idx
  on item_number_aliases (item_id, item_number);

create index item_number_aliases_lookup_idx on item_number_aliases (item_number);

alter table item_number_aliases enable row level security;
```

### 3.4 Swap the generated column for a maintained one

The `item_duplicate_candidates` view (0012) selects `items.item_number`, and a
view's dependency on a column blocks dropping it. So the view is dropped and
recreated verbatim around the swap — **not** `DROP ... CASCADE`, so the
recreation is visible in the migration and cannot be silently forgotten.
Recreating a view resets its grants, so 0012's `anon`/`authenticated` revokes
are reapplied with it.

It is the only such dependent: `merge_items` also mentions `item_number`, but
plpgsql bodies are not dependency-tracked and it keeps working untouched.

```sql
drop view item_duplicate_candidates;

alter table items drop constraint items_item_number_key;
alter table items drop column item_number;
alter table items add column item_number text;

create view item_duplicate_candidates ... -- verbatim from 0012
```

### 3.5 Triggers

```sql
create or replace function items_set_item_number() returns trigger
language plpgsql as $$
begin
  new.item_number := item_number_for(new.category_id, new.item_seq);

  if tg_op = 'UPDATE' and old.item_number is distinct from new.item_number then
    insert into item_number_aliases (item_id, item_number)
    values (old.id, old.item_number)
    on conflict do nothing;
  end if;

  return new;
end $$;

-- fires on every insert/update, not just `update of category_id`: the
-- category-side trigger below writes item_number directly, and that write
-- must still pass through here so the alias gets recorded.
create trigger items_item_number_biu
before insert or update on items
for each row execute function items_set_item_number();
```

```sql
create or replace function categories_propagate_code() returns trigger
language plpgsql as $$
begin
  update items i
     set item_number = item_number_for(i.category_id, i.item_seq)
   where i.category_id = new.id
      or i.category_id in (select id from categories where parent_category_id = new.id);
  return null;
end $$;

create trigger categories_code_change_aut
after update on categories
for each row
when (old.code is distinct from new.code
      or old.parent_category_id is distinct from new.parent_category_id)
execute function categories_propagate_code();
```

**Verify during implementation:** identity columns are populated by a column
default, which Postgres applies before row-level `BEFORE INSERT` triggers run —
so `new.item_seq` is expected to be non-null inside the trigger. Assert this
with a test insert before trusting it; if it comes back null, move the
assignment to an `AFTER INSERT` trigger that issues a self-update.

### 3.6 Backfill

Old numbers are deterministic (`'I-' || lpad(item_seq,4,'0')`), so they can be
reconstructed rather than captured before the drop.

```sql
-- record the outgoing number as an alias, but only where it actually changes
insert into item_number_aliases (item_id, item_number)
select id, 'I-' || lpad(item_seq::text, 4, '0')
from items
where item_number_for(category_id, item_seq) <> 'I-' || lpad(item_seq::text, 4, '0');

-- assign the new numbers (the trigger recomputes to the same value; harmless)
update items set item_number = item_number_for(category_id, item_seq);

alter table items alter column item_number set not null;
alter table items add constraint items_item_number_key unique (item_number);
```

The unique constraint is structurally redundant per §0. Keep it as a backstop
against a future manual-override feature reintroducing collisions.

## 4. Application changes

All built.

| Change | File |
| --- | --- |
| Alias-aware item lookup — a second query against `item_number_aliases`, folded into the `.or()` filter as an `id.in.(…)` clause, because PostgREST cannot join | `lib/item-search.ts` (new), used by `submit/actions.ts` and `pricelist/actions.ts` |
| Categories editor: add, rename, re-parent, set code, delete | `pricelist/categories-manager.tsx` (new) |
| `createCategory` / `updateCategory` / `deleteCategory` | `pricelist/actions.ts` |
| Its own route, plus a `Manage · Categories · Units` link row on the Pricelist | `pricelist/categories/page.tsx`, `pricelist/units/page.tsx` (both new), `pricelist/page.tsx` |

Categories and Units are subpages rather than disclosures on the Pricelist:
Categories became master data the moment its code started prefixing item
numbers, and nineteen rows of it pushed the offers table off the screen. Both
routes reuse the `pricelist` page key with `edit_master_data` — no new
`app_pages` or `app_actions` rows, following the System errors precedent in
`lib/nav.ts`, since a new page key would leave every existing team locked out
until someone re-granted it. Static route segments beat `[id]` in Next.js and
item ids are UUIDs, so neither route can be shadowed by `/pricelist/[id]`.

No change was needed for reclassification itself — `updateItem` already handles
`category_id` and audits it to `item_history`.

Editor decisions worth knowing:

- **Codes are normalised, not rejected, on case.** Typing `chk` stores `CHK`.
- **Delete refuses and says why**, naming the items, subcategories, receipt
  lines or vendor offers still pointing at the category. Reassigning them
  would be a bulk edit with real consequences for item numbers, and that
  belongs on the items, not behind a delete button.
- **Re-parenting is blocked for a category that has children of its own**,
  holding the one-level hierarchy `0008` established.
- **The edit form warns before a renumber**, naming how many items the code
  change will affect, and that their old numbers stay searchable.

## 5. Rollout order

The migration is written as one file, `0024_category_item_numbers.sql`, since
the cleanup left `items` empty and the backfill in §3.6 is therefore a no-op —
there is nothing to stage.

1. Apply `0024` in the Supabase SQL Editor.
2. Run `supabase/maintenance/verify_0024.sql`. It exercises insert,
   reclassification, alias retention and parent-code fallback inside a
   transaction, rolls back, and rewinds `item_seq` so the first real item is
   still `0001`.
3. Deploy the app changes in §4.

Rollback: drop the two triggers and their functions, restore `item_number` as
the original generated column, drop `item_number_aliases` and
`categories.code`. No data outside these objects is touched.

## 6. On hand-editable numbers

Recommended: **defer.** With the prefix derived, the misclassification case
that motivated manual editing fixes itself the moment the category is
corrected, and there is nothing left to type.

If it is still wanted afterwards, it is small: an `items.item_number_override`
column consulted first by `items_set_item_number()`, plus a new `app_actions`
row so it is grantable separately from `edit_master_data` (the Teams UI renders
the `app_pages × app_actions` cross product, so a seed insert is most of the
work). Overrides are the one thing that can make the unique constraint in §3.6
fire in anger.

## 7. Data cleanup (independent of the above)

Wipe operational data, keep people. Tables fall into four tiers:

**Tier A — keep always (identity & access):** `profiles`, `teams`,
`team_members`, `app_pages`, `app_actions`, `team_permissions`.

**Tier B — transactional:** `expense_status_history`, `expense_line_items`,
`expenses`, `notifications`, `error_events`, `password_reset_attempts`.

**Tier C — master data:** `vendor_item_descriptions`,
`item_duplicate_dismissals`, `item_history`, `pricelist_item_history`,
`pricelist_items`, `item_pack_sizes`, `items`, `vendor_contacts`,
`vendor_collection_addresses`, `vendors`, `item_number_aliases`.

**Tier D — per-user UI state:** `user_column_preferences`,
`user_dashboard_widgets`.

**Tier E — reference lists:** `categories`, `units`.

Tier C cannot be cleared without Tier B (line items reference offers). Tier B
alone is fine.

**Decided: clear B, C and D. Keep A and E** — everyone keeps their login and
gets default views back; the category and unit lists survive, so no re-seeding
is needed before the app is usable again.

### Method

Written up as two files, because no single tool can do both halves:

| File | Does |
| --- | --- |
| `supabase/maintenance/2026-09-05_reset-operational-data.sql` | The truncate. Pasted into the Supabase SQL Editor, the same route the migrations take. |
| `scripts/cleanup-data.mjs` | Reports row counts before the fact, and empties the storage bucket after. Read-only unless passed `--empty-bucket`. |

The SQL is one `TRUNCATE` naming every table explicitly, **without
`CASCADE`**. That omission is the safety feature: if a referencing table is
missed, Postgres refuses the whole statement rather than silently widening the
blast radius. Verified complete as of migration `0023` — every table with a
foreign key into `vendors`, `expenses`, `items`, `pricelist_items` or
`item_pack_sizes` is named.

`RESTART IDENTITY` rewinds `item_seq`, `vendor_seq` and `expense_seq`, so
numbering begins again at `0001` instead of continuing from wherever the test
data left off. The whole thing runs inside a transaction with a count check
before `COMMIT`.

Once `0024` lands, `item_number_aliases` must be added to the truncate list.

### Also required

- **Receipt files.** `expenses.receipt_file_path` points into the Supabase
  `receipts` storage bucket (`lib/receipts.ts:28`). Storage is not in the
  database, so truncating expenses orphans every file. `cleanup-data.mjs
  --empty-bucket` deletes them.
- **Leave anything in the Downloads folder alone** — only database records and
  bucket objects are in scope.
- No re-seeding needed: `categories` and `units` are kept.

### Order

1. `node scripts/cleanup-data.mjs` — report only, confirm the counts.
2. Run the SQL in the Supabase SQL Editor; check the `SELECT` output; `COMMIT`.
3. `node scripts/cleanup-data.mjs --empty-bucket`.
