-- Item numbers carry their category: I-0042 becomes CHK-0042.
--
-- The number said nothing about what it named, so a list of item numbers was
-- unreadable without looking every one of them up, and an item filed under
-- the wrong category was invisible in the numbering.
--
-- The tail stays the item's permanent item_seq rather than becoming a
-- per-category counter, and that choice is what makes the whole thing safe.
-- item_seq is a single global identity sequence: exactly one item ever holds
-- 42, and it holds it forever. So the numeric half is already unique on its
-- own and the prefix carries no uniqueness burden at all — reclassifying
-- Chicken -> Beef turns CHK-0042 into BEF-0042, and BEF-0042 cannot already
-- be taken, because the only row that could hold it is the row being moved.
--
-- A per-category counter ("the 42nd chicken item") would collide on contact:
-- Beef has a 42nd item too. That design needs collision handling, manual
-- renumbering and a reservation story. This one needs none of them.
--
-- The cost is that numbers within a category are gappy — CHK-0042, CHK-0117,
-- CHK-0203. That is the deliberate trade for never having to renumber.
--
-- Numbers that go out of use are kept in item_number_aliases so anything
-- still quoting the old one resolves, mirroring how 0023 keeps an item's
-- former names as descriptions so a rename cannot break receipt matching.

-- ---------------------------------------------------------------------
-- 1. Category codes
-- ---------------------------------------------------------------------

alter table categories add column code text;

alter table categories add constraint categories_code_format
  check (code is null or code ~ '^[A-Z][A-Z0-9]{1,5}$');

-- Partial: most of the point is that a category may sit uncoded, and NULLs
-- must not collide with each other.
create unique index categories_code_key on categories (code) where code is not null;

update categories set code = v.code
from (
  values
    ('Groceries & Provisions', 'GRO'),
    ('Meat & Poultry', 'MEA'),
    ('Mutton', 'MUT'),
    ('Beef', 'BEF'),
    ('Chicken', 'CHK'),
    ('Produce (Fruit & Vegetables)', 'PRD'),
    ('Dairy & Eggs', 'DRY'),
    ('Bakery', 'BAK'),
    ('Beverages', 'BEV'),
    ('Disposables & Packaging', 'DIS'),
    ('Cleaning & Sanitation', 'CLN'),
    ('Kitchen Equipment & Utensils', 'KIT'),
    ('Gas & Fuel', 'GAS'),
    ('Maintenance & Repairs', 'MNT'),
    ('Events & Venue', 'EVT'),
    ('Transport & Logistics', 'TRN'),
    ('Stationery & Printing', 'STN'),
    ('Professional & Contractor Services', 'PRO'),
    ('Miscellaneous', 'MSC')
) as v(name, code)
where categories.name = v.name;

-- ---------------------------------------------------------------------
-- 2. How a number is derived
-- ---------------------------------------------------------------------

-- Items are only ever assigned to leaf categories, but the leaf is the level
-- most likely to be added later and left uncoded. Falling back to the parent
-- means coding only the top level still yields sensible prefixes, and the
-- final fallback to 'I' reproduces exactly what uncategorised items read
-- today.
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

-- ---------------------------------------------------------------------
-- 3. Retired numbers stay resolvable
-- ---------------------------------------------------------------------

create table item_number_aliases (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items (id) on delete cascade,
  item_number text not null,
  retired_at  timestamptz not null default now()
);

-- An alias can never point at a different item than a live number with the
-- same text, because the numeric tail pins the item. The only duplicate
-- possible is the same item reclaiming a number it already owned (Chicken ->
-- Beef -> Chicken), which is what this index collapses.
create unique index item_number_aliases_unique_idx
  on item_number_aliases (item_id, item_number);

create index item_number_aliases_lookup_idx on item_number_aliases (item_number);

alter table item_number_aliases enable row level security;

-- ---------------------------------------------------------------------
-- 4. item_number stops being generated
-- ---------------------------------------------------------------------

-- It now depends on a joined table, which a generated column cannot do.
--
-- item_duplicate_candidates selects items.item_number, and a view's dependency
-- on a column blocks dropping it. Dropped and recreated verbatim around the
-- swap rather than with DROP ... CASCADE, so the recreation is visible here
-- and cannot be silently forgotten.
drop view item_duplicate_candidates;

alter table items drop constraint items_item_number_key;
alter table items drop column item_number;
alter table items add column item_number text;

-- Verbatim from 0012, which is still the authority on what it means.
create view item_duplicate_candidates
with (security_invoker = on) as
select
  a.id            as item_id,
  a.name          as item_name,
  a.item_number,
  b.id            as candidate_id,
  b.name          as candidate_name,
  b.item_number   as candidate_item_number,
  b.category_id   as candidate_category_id,
  b.status        as candidate_status,
  round(similarity(a.name, b.name)::numeric, 3) as score
from items a
join items b
  on b.id <> a.id
 and a.name % b.name
 and (a.category_id is not distinct from b.category_id
      or a.category_id is null
      or b.category_id is null)
where not exists (
  select 1 from item_duplicate_dismissals d
  where d.item_a = least(a.id, b.id) and d.item_b = greatest(a.id, b.id)
);

-- Recreating the view resets its grants, so the 0012 revokes are reapplied.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on item_duplicate_candidates from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on item_duplicate_candidates from authenticated';
  end if;
end $$;

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

-- Fires on every insert and update, not just `update of category_id`: the
-- category-side trigger below writes item_number directly, and that write
-- has to pass through here for the alias to be recorded.
--
-- item_seq is an identity column, populated from a column default, and
-- Postgres applies defaults before row-level BEFORE triggers run — so
-- new.item_seq is already set by the time this executes on INSERT.
create trigger items_item_number_biu
before insert or update on items
for each row execute function items_set_item_number();

-- Recoding or re-parenting a category renumbers everything filed under it,
-- including children that inherit the prefix by falling back to the parent.
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

-- ---------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------

-- The old value was deterministic, so it can be reconstructed rather than
-- captured before the drop above. Only rows whose number actually changes
-- earn an alias; a category left uncoded still reads I-0042 and has nothing
-- to retire.
insert into item_number_aliases (item_id, item_number)
select id, 'I-' || lpad(item_seq::text, 4, '0')
from items
where item_number_for(category_id, item_seq) <> 'I-' || lpad(item_seq::text, 4, '0');

update items set item_number = item_number_for(category_id, item_seq);

alter table items alter column item_number set not null;

-- Structurally redundant given the argument at the top of this file. Kept as
-- a backstop in case a manual-override column is ever added, which is the
-- one change that could reintroduce collisions.
alter table items add constraint items_item_number_key unique (item_number);
