-- Receipt extraction creates an Item for every line it can't match by exact
-- name, so OCR and vendor wording variants ("Chicken Thigh", "Chicken
-- Thighs", "Thigh Fillet") accumulate as separate products with separate
-- price histories. Left alone that quietly corrupts per-unit comparison —
-- the thing the Pricelist exists to do. Two halves to the fix:
--
--   item_duplicate_candidates  — surfaces likely duplicates so they get
--                                noticed instead of silently piling up
--   merge_items()              — folds one item into another atomically,
--                                preserving purchase history
--
-- Merging is deliberately a whole-item operation done in one transaction:
-- doing it as a sequence of client-side updates risks leaving expense line
-- items pointing at a half-deleted item.

create extension if not exists pg_trgm;

create index if not exists items_name_trgm_idx on items using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Likely duplicates
-- ---------------------------------------------------------------------

-- Name similarity can't distinguish "Chicken Thigh"/"Chicken Thighs" (the
-- same product) from "Chicken Thighs"/"Chicken Thigh Fillets" (genuinely
-- different cuts). Without a way to say "these two are fine", the suggestion
-- list nags forever about legitimate products and gets ignored — so record
-- the decision. Pair is stored with the lower id first so it is order-free.
create table if not exists item_duplicate_dismissals (
  item_a uuid not null references items (id) on delete cascade,
  item_b uuid not null references items (id) on delete cascade,
  dismissed_by uuid references profiles (id),
  dismissed_at timestamptz not null default now(),
  primary key (item_a, item_b),
  constraint item_duplicate_dismissals_ordered check (item_a < item_b)
);

alter table item_duplicate_dismissals enable row level security;

create or replace view item_duplicate_candidates
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
 -- % uses the trigram index; similarity() then gives the score for ranking
 and a.name % b.name
 -- an uncategorised item is a plausible duplicate of anything, since
 -- receipt-created items often arrive without a category
 and (a.category_id is not distinct from b.category_id
      or a.category_id is null
      or b.category_id is null)
where not exists (
  select 1 from item_duplicate_dismissals d
  where d.item_a = least(a.id, b.id) and d.item_b = greatest(a.id, b.id)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on item_duplicate_candidates from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on item_duplicate_candidates from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------

create or replace function merge_items(p_loser uuid, p_winner uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loser        items%rowtype;
  v_winner       items%rowtype;
  v_loser_base   text;
  v_winner_base  text;
  v_pack         record;
  v_target_pack  uuid;
  v_dupe         record;
  v_keep         uuid;
  v_packs_moved  int := 0;
  v_packs_merged int := 0;
  v_offers_moved int := 0;
  v_offers_merged int := 0;
  v_lines_moved  int := 0;
  v_moved        int := 0;
begin
  if p_loser = p_winner then
    raise exception 'Cannot merge an item into itself.';
  end if;

  select * into v_loser from items where id = p_loser;
  if not found then raise exception 'Item to merge was not found.'; end if;
  select * into v_winner from items where id = p_winner;
  if not found then raise exception 'Target item was not found.'; end if;

  -- Merging across dimensions (a kg item into an L item) is always a
  -- mistake and would silently produce meaningless per-unit costs.
  select base_unit_code into v_loser_base from units where id = v_loser.canonical_unit_id;
  select base_unit_code into v_winner_base from units where id = v_winner.canonical_unit_id;
  if v_loser_base is distinct from v_winner_base then
    raise exception 'Cannot merge: % is measured in % but % is measured in %.',
      v_loser.name, v_loser_base, v_winner.name, v_winner_base;
  end if;

  -- 1. Move pack sizes, folding any that already exist on the winner.
  for v_pack in select * from item_pack_sizes where item_id = p_loser loop
    select id into v_target_pack
    from item_pack_sizes
    where item_id = p_winner
      and inner_quantity = v_pack.inner_quantity
      and inner_unit_id = v_pack.inner_unit_id
      and pack_count = v_pack.pack_count
      and label is not distinct from v_pack.label
    limit 1;

    if v_target_pack is null then
      update item_pack_sizes set item_id = p_winner where id = v_pack.id;
      v_packs_moved := v_packs_moved + 1;
    else
      update pricelist_items set pack_size_id = v_target_pack where pack_size_id = v_pack.id;
      delete from item_pack_sizes where id = v_pack.id;
      v_packs_merged := v_packs_merged + 1;
    end if;
  end loop;

  -- 2. Collapse offers that now duplicate on (vendor, pack size). These are
  --    two rows both claiming "this vendor sells this pack at this price", so
  --    prefer one that actually carries a price, then the most recently
  --    updated as the more current quote. id last, purely so the choice is
  --    deterministic when timestamps tie (rows written in one transaction
  --    share a created_at).
  for v_dupe in
    select vendor_id, pack_size_id,
           array_agg(id order by (pack_price is null), updated_at desc, created_at desc, id) as ids
    from pricelist_items
    where pack_size_id in (select id from item_pack_sizes where item_id = p_winner)
    group by vendor_id, pack_size_id
    having count(*) > 1
  loop
    v_keep := v_dupe.ids[1];
    update expense_line_items set pricelist_item_id = v_keep
      where pricelist_item_id = any(v_dupe.ids[2:]);
    get diagnostics v_moved = row_count;
    v_lines_moved := v_lines_moved + v_moved;
    update pricelist_item_history set item_id = v_keep where item_id = any(v_dupe.ids[2:]);
    delete from pricelist_items where id = any(v_dupe.ids[2:]);
    v_offers_merged := v_offers_merged + array_length(v_dupe.ids, 1) - 1;
  end loop;

  select count(*) into v_offers_moved
  from pricelist_items
  where pack_size_id in (select id from item_pack_sizes where item_id = p_winner);

  -- 3. Keep the losing item's change history against the survivor.
  update item_history set item_id = p_winner where item_id = p_loser;

  insert into item_history (item_id, changed_by, changes)
  values (
    p_winner,
    p_actor,
    jsonb_build_object(
      'merged',
      jsonb_build_object(
        'old', coalesce(v_loser.item_number || ' — ', '') || v_loser.name,
        'new', 'merged into this item'
      )
    )
  );

  delete from items where id = p_loser;

  return jsonb_build_object(
    'pack_sizes_moved', v_packs_moved,
    'pack_sizes_merged', v_packs_merged,
    'offers_on_winner', v_offers_moved,
    'offers_merged', v_offers_merged,
    'line_items_repointed', v_lines_moved
  );
end;
$$;

revoke all on function merge_items(uuid, uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function merge_items(uuid, uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function merge_items(uuid, uuid, uuid) from authenticated';
  end if;
end $$;
