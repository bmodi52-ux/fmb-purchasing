-- Item numbers count from 001 within their own category.
--
-- 0024 made the tail a global sequence on purpose: exactly one item ever holds
-- 42, so reclassifying Chicken -> Beef turned CHK-0042 into BEF-0042 and
-- BEF-0042 could not already be taken. Nothing ever had to be renumbered, and
-- the price was gappy numbers — the first item ever filed under Chicken read
-- CHK-0003, because it was the third item created anywhere.
--
-- That gappiness is the thing people actually read, and it makes the number
-- look wrong on every order sheet it is written on. So the trade is taken the
-- other way round: numbering is per category, and the machinery that a
-- per-category counter needs is built rather than avoided.
--
-- What that machinery is:
--
--   A counter per category, allocated under an advisory lock held for the
--   transaction. Two receipts creating a Chicken item at the same moment
--   would otherwise both read "the highest is 4" and both claim 5; the lock
--   makes the second wait, and the unique index below is the backstop if it
--   ever does not.
--
--   Renumbering on reclassify. An item moved from Chicken to Beef is not
--   BEF-0003 — that number belongs to Beef's third item — so it takes the next
--   free number in Beef and its old number retires into item_number_aliases,
--   which 0024 built for exactly this and which item search already reads. A
--   number written on paperwork last month still finds its item.
--
--   Uncategorised items are their own bucket, numbered I-0001 upwards. They
--   are renumbered into a real category the moment somebody files them.
--
-- Vacated numbers are not reused. Chicken's fourth item stays CHK-0004 after
-- CHK-0002 is moved away, and the next new one is CHK-0005. Reusing a number
-- would point two items at one alias, and shuffling the rest to close the gap
-- would change numbers already written down — the one thing worse than a gap.

alter table items add column category_seq int;

comment on column items.category_seq is
  'This item''s position within its own category, from 1. The tail of its item '
  'number. Reassigned when the item changes category; see 0039.';

-- ---------------------------------------------------------------------
-- 1. Allocating the number
-- ---------------------------------------------------------------------

create or replace function items_assign_category_seq() returns trigger
language plpgsql as $$
begin
  -- Only when there is no number yet, or the item has moved to a category
  -- where its old one means nothing. An ordinary edit keeps what it has.
  if tg_op = 'INSERT'
     or new.category_seq is null
     or new.category_id is distinct from old.category_id then

    -- Serialises allocation per category for the rest of the transaction, so
    -- two simultaneous submissions cannot both be told the highest is 4.
    -- Uncategorised items share one bucket of their own.
    perform pg_advisory_xact_lock(
      hashtext('items.category_seq:' || coalesce(new.category_id::text, 'uncategorised'))
    );

    select coalesce(max(category_seq), 0) + 1
      into new.category_seq
      from items
     where category_id is not distinct from new.category_id
       and id is distinct from new.id;
  end if;

  return new;
end $$;

-- Fires before items_item_number_biu, which reads what this assigns. Row
-- triggers run in name order, and 'items_category_seq_biu' sorts before
-- 'items_item_number_biu' — the dependency is real, so keep the names in that
-- order if either is ever renamed.
create trigger items_category_seq_biu
before insert or update on items
for each row execute function items_assign_category_seq();

-- ---------------------------------------------------------------------
-- 2. The number itself
-- ---------------------------------------------------------------------

-- Verbatim from 0024 apart from the sequence it reads: the prefix still comes
-- from the category, falling back to the parent's code and then to 'I'.
create or replace function items_set_item_number() returns trigger
language plpgsql as $$
begin
  new.item_number := item_number_for(new.category_id, new.category_seq);

  if tg_op = 'UPDATE' and old.item_number is distinct from new.item_number then
    insert into item_number_aliases (item_id, item_number)
    values (old.id, old.item_number)
    on conflict do nothing;
  end if;

  return new;
end $$;

-- Recoding or re-parenting a category still renumbers everything under it —
-- the prefix changes, the tail does not.
create or replace function categories_propagate_code() returns trigger
language plpgsql as $$
begin
  update items i
     set item_number = item_number_for(i.category_id, i.category_seq)
   where i.category_id = new.id
      or i.category_id in (select id from categories where parent_category_id = new.id);
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Existing items
-- ---------------------------------------------------------------------

-- Oldest first within each category, so the item that has been in Chicken
-- longest is CHK-0001. item_seq is the creation order and is kept for exactly
-- this kind of question, now that it no longer names anything.
--
-- The update passes through both triggers above, so every item whose number
-- changes files its old one in item_number_aliases on the way — CHK-0003 still
-- resolves to the item that used to be called that.
with numbered as (
  select id, row_number() over (partition by category_id order by item_seq) as seq
  from items
)
update items i
   set category_seq = n.seq
  from numbered n
 where n.id = i.id;

alter table items alter column category_seq set not null;

-- The backstop the advisory lock is meant to make unnecessary. Two indexes
-- because a null category_id is a bucket, not an absence, and a plain unique
-- index would let uncategorised items collide freely.
create unique index items_category_seq_key
  on items (category_id, category_seq)
  where category_id is not null;

create unique index items_uncategorised_seq_key
  on items (category_seq)
  where category_id is null;
