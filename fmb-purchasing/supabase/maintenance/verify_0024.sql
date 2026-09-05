-- Verification for migration 0024. Run once, immediately after applying it.
--
-- NOT a migration. Everything here is rolled back; the only lasting effect is
-- the sequence rewind at the very end, which undoes the item_seq values this
-- script consumes (Postgres sequences are non-transactional, so ROLLBACK does
-- not return them).
--
-- Proves the four things the migration asserts but cannot check for itself:
--
--   1. item_seq is populated before the BEFORE INSERT trigger runs. This is
--      the one genuinely unproven assumption in 0024 — identity columns are
--      filled from a column default, and defaults are applied before
--      row-level BEFORE triggers, but a wrong answer here would silently
--      number every new item "CHK-0000".
--   2. Reclassifying renumbers the item.
--   3. The number it vacates is kept as an alias.
--   4. A category with no code of its own inherits its parent's prefix.

begin;

do $$
declare
  v_unit_id  uuid;
  v_chicken  uuid;
  v_beef     uuid;
  v_meat     uuid;
  v_item_id  uuid;
  v_number   text;
  v_seq      int;
begin
  select id into v_unit_id from units limit 1;
  select id into v_chicken from categories where name = 'Chicken';
  select id into v_beef    from categories where name = 'Beef';
  select id into v_meat    from categories where name = 'Meat & Poultry';

  if v_unit_id is null or v_chicken is null or v_beef is null then
    raise exception 'Fixtures missing: need at least one unit and the Chicken/Beef categories';
  end if;

  -- 1. assigned on insert, from a populated item_seq
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_0024__', v_unit_id, v_chicken)
  returning id, item_number, item_seq into v_item_id, v_number, v_seq;

  if v_seq is null then
    raise exception 'item_seq was null inside the trigger — 0024 needs an AFTER INSERT trigger instead';
  end if;
  if v_number <> 'CHK-' || lpad(v_seq::text, 4, '0') then
    raise exception 'Expected CHK-%, got %', lpad(v_seq::text, 4, '0'), v_number;
  end if;
  raise notice '1. insert  -> % (item_seq %)', v_number, v_seq;

  -- 2. reclassification renumbers
  update items set category_id = v_beef where id = v_item_id;
  select item_number into v_number from items where id = v_item_id;

  if v_number <> 'BEF-' || lpad(v_seq::text, 4, '0') then
    raise exception 'Expected BEF-%, got %', lpad(v_seq::text, 4, '0'), v_number;
  end if;
  raise notice '2. reclassify -> %', v_number;

  -- 3. the vacated number is still resolvable
  if not exists (
    select 1 from item_number_aliases
    where item_id = v_item_id and item_number = 'CHK-' || lpad(v_seq::text, 4, '0')
  ) then
    raise exception 'No alias recorded for the retired CHK number';
  end if;
  raise notice '3. alias    -> CHK-% retained', lpad(v_seq::text, 4, '0');

  -- 4. an uncoded child falls back to its parent's code
  if v_meat is not null then
    update categories set code = null where id = v_beef;
    select item_number into v_number from items where id = v_item_id;

    if v_number <> 'MEA-' || lpad(v_seq::text, 4, '0') then
      raise exception 'Expected the parent prefix MEA-%, got %', lpad(v_seq::text, 4, '0'), v_number;
    end if;
    raise notice '4. fallback -> % (Beef uncoded, inherits Meat & Poultry)', v_number;
  end if;

  raise notice 'All checks passed.';
end $$;

rollback;

-- The insert above consumed an item_seq value that ROLLBACK cannot return.
-- Rewind so the first real item is still 0001.
alter table items alter column item_seq restart with 1;

-- Should be 0 rows and 0 aliases.
select (select count(*) from items) as items,
       (select count(*) from item_number_aliases) as aliases;
