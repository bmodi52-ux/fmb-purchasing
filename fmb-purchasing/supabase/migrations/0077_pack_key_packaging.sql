-- 0077 — a pack's packaging and "sold loose" are part of what makes it a
-- different pack (#49).
--
-- The uniqueness key from 0009 is (item, inner quantity, unit, count, label).
-- Packaging and sold_loose came later (0040) and were never added to it, so a
-- 1 L bottle and a loose 1 L of the same milk counted as one pack. Adding the
-- bottle on the item page failed on the key and nothing said so; a receipt
-- line naming the bottle quietly reused the loose pack.
--
-- Widening a unique key can't fail on existing rows. merge_items folds a
-- losing item's packs onto the winner's by shape; it now compares packaging
-- and sold_loose too, so a bottle is never folded into a loose pack.

alter table item_pack_sizes drop constraint item_pack_sizes_shape_key;
alter table item_pack_sizes add constraint item_pack_sizes_shape_key
  unique nulls not distinct (item_id, inner_quantity, inner_unit_id, pack_count, label, sold_loose, packaging);

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
      and sold_loose = v_pack.sold_loose
      and packaging is not distinct from v_pack.packaging
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

insert into schema_migrations (filename) values ('0077_pack_key_packaging.sql')
on conflict do nothing;
