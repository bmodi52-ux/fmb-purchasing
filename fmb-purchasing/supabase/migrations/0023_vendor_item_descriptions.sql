-- Receipts only ever linked to an Item by the Item's *current* name, which
-- meant tidying a name broke matching for good. A receipt line reading
-- "Bekaa Natural Set Yoghurt 5kg" created an item of that name; renaming it
-- to "Yoghurt" so the pricelist read cleanly guaranteed the next receipt for
-- the same product no longer matched and created a second item. The tidier
-- the pricelist, the worse matching got.
--
-- So record the wording instead of relying on the name: every receipt
-- description that has resolved to an item is remembered here, and matching
-- consults it. Renaming an item keeps its old name as a description, so a
-- rename can no longer break the link.
--
-- vendor_id is nullable on purpose. A description learnt from a receipt
-- belongs to that vendor, and (vendor, wording) is the strongest signal there
-- is — near-certainly the same offer. A description carried over from a
-- rename belongs to no vendor in particular, and is still useful for matching
-- any vendor's receipt to the item.

create table vendor_item_descriptions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  vendor_id uuid references vendors (id) on delete set null,
  -- as it appeared on the receipt, for a person to read
  description text not null,
  -- lowercased and whitespace-collapsed, mirroring normalize() in
  -- expense-matching.ts — this is what matching actually compares
  description_normalized text not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id)
);

-- coalesce rather than a plain unique constraint: Postgres treats NULLs as
-- distinct, so without this the same vendorless wording could be recorded
-- against one item over and over.
create unique index vendor_item_descriptions_unique_idx
  on vendor_item_descriptions (
    item_id,
    coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    description_normalized
  );

-- The matching lookup is "who owns this wording", from a cold start on every
-- submitted line.
create index vendor_item_descriptions_lookup_idx
  on vendor_item_descriptions (description_normalized);

alter table vendor_item_descriptions enable row level security;

-- ---------------------------------------------------------------------
-- Backfill, so matching starts knowing what it has already been told
-- ---------------------------------------------------------------------

-- Every receipt line already linked to an offer is a wording that a human
-- accepted for that item. This is what repairs items renamed before today.
insert into vendor_item_descriptions (item_id, vendor_id, description, description_normalized)
select distinct
  ps.item_id,
  e.vendor_id,
  btrim(l.description_raw),
  lower(regexp_replace(btrim(l.description_raw), '\s+', ' ', 'g'))
from expense_line_items l
join pricelist_items o on o.id = l.pricelist_item_id
join item_pack_sizes ps on ps.id = o.pack_size_id
join expenses e on e.id = l.expense_id
where l.description_raw is not null
  and btrim(l.description_raw) <> ''
on conflict do nothing;

-- Names an item has been renamed away from. Recoverable because every rename
-- was written to item_history.
insert into vendor_item_descriptions (item_id, vendor_id, description, description_normalized)
select distinct
  h.item_id,
  null::uuid,
  btrim(h.changes -> 'name' ->> 'old'),
  lower(regexp_replace(btrim(h.changes -> 'name' ->> 'old'), '\s+', ' ', 'g'))
from item_history h
join items i on i.id = h.item_id
where h.changes ? 'name'
  and coalesce(btrim(h.changes -> 'name' ->> 'old'), '') <> ''
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Merging has to carry descriptions across
-- ---------------------------------------------------------------------

-- Unchanged from 0012 except for step 3, which repoints the losing item's
-- descriptions onto the survivor. Without it the on-delete cascade would
-- throw away exactly the wording that will appear on the next receipt, and
-- the merge would immediately un-merge itself.
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

  -- 3. Carry the losing item's receipt wordings across, dropping any the
  --    winner already knows. The loser's own name joins them: it is what the
  --    next receipt for this product is most likely to say.
  delete from vendor_item_descriptions d
  where d.item_id = p_loser
    and exists (
      select 1 from vendor_item_descriptions w
      where w.item_id = p_winner
        and w.description_normalized = d.description_normalized
        and coalesce(w.vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(d.vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  update vendor_item_descriptions set item_id = p_winner where item_id = p_loser;

  insert into vendor_item_descriptions (item_id, vendor_id, description, description_normalized, created_by)
  values (
    p_winner,
    null,
    v_loser.name,
    lower(regexp_replace(btrim(v_loser.name), '\s+', ' ', 'g')),
    p_actor
  )
  on conflict do nothing;

  -- 4. Keep the losing item's change history against the survivor.
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
