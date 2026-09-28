-- 0081 — two brands of one pack at one store are two offers, and a receipt
-- finds the right one (#55).
--
-- Since 0078 a store holds one live offer per pack size and brand, but
-- nothing on the way in chose between them: a receipt line was filed against
-- the store's offer on the pack, whichever brand it was, and since #46 its
-- price became that offer's price. Buying the other brand next time
-- overwrote this one's. The app now files a line by its brand; this adds
-- what that needs in the database.
--
-- vendor_item_descriptions.pricelist_item_id — the offer this store's wording
--   was last filed against. A wording used to say only which item a line was;
--   now it can say which offer, so the pack and the brand come with it. Null
--   where the same wording has meant more than one offer, which is left for a
--   person to choose. Filled here from past receipts where a wording only
--   ever went to one offer.
--
-- merge_items — keeps one offer per store, pack and brand, as 0078's index
--   does, instead of one per store and pack, which deleted a second brand's
--   offer. It could also fail outright: moving an offer onto a pack where the
--   same store already had that brand broke the index.

alter table vendor_item_descriptions
  add column pricelist_item_id uuid references pricelist_items (id) on delete set null;

comment on column vendor_item_descriptions.pricelist_item_id is
  'The offer this store''s wording was last filed against: its pack and brand. Null when unknown, or when the wording has meant more than one offer. #55.';

create index vendor_item_descriptions_offer_idx
  on vendor_item_descriptions (pricelist_item_id)
  where pricelist_item_id is not null;

-- ---------------------------------------------------------------------
-- Past receipts: a store's wording that only ever went to one of its live
-- offers means that offer.
-- ---------------------------------------------------------------------
update vendor_item_descriptions d
set pricelist_item_id = one.offer_id
from (
  select e.vendor_id,
         ps.item_id,
         lower(regexp_replace(btrim(l.description_raw), '\s+', ' ', 'g')) as wording,
         (array_agg(distinct o.id))[1] as offer_id
  from expense_line_items l
  join expenses e on e.id = l.expense_id
  join pricelist_items o on o.id = l.pricelist_item_id
    and o.vendor_id = e.vendor_id
    and o.status <> 'rejected'
  join item_pack_sizes ps on ps.id = o.pack_size_id
  where coalesce(btrim(l.description_raw), '') <> ''
  group by 1, 2, 3
  having count(distinct o.id) = 1
) one
where d.vendor_id = one.vendor_id
  and d.item_id = one.item_id
  and d.description_normalized = one.wording;

-- ---------------------------------------------------------------------
-- merge_items: unchanged from 0077 except for how offers are folded
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
  v_offer        record;
  v_other        uuid;
  v_keep         uuid;
  v_drop         uuid;
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
      -- 2. The pack's offers join the winner's pack. Where the same store
      --    already sells the same brand there, the two are one offer (0078):
      --    keep the one that carries a price, then the most recently updated,
      --    and move the other's receipt lines, history and wordings onto it.
      --    A different brand is a different offer, and moves as it is.
      for v_offer in
        select * from pricelist_items
        where pack_size_id = v_pack.id and status <> 'rejected' and vendor_id is not null
      loop
        select id into v_other
        from pricelist_items
        where pack_size_id = v_target_pack
          and vendor_id = v_offer.vendor_id
          and status <> 'rejected'
          and lower(btrim(coalesce(brand, ''))) = lower(btrim(coalesce(v_offer.brand, '')))
        limit 1;
        continue when v_other is null;

        select id into v_keep
        from pricelist_items
        where id in (v_offer.id, v_other)
        order by (pack_price is null), updated_at desc, created_at desc, id
        limit 1;
        v_drop := case when v_keep = v_offer.id then v_other else v_offer.id end;

        update pricelist_items k
        set vendor_sku = coalesce(k.vendor_sku, d.vendor_sku),
            store_product_name = coalesce(k.store_product_name, d.store_product_name)
        from pricelist_items d
        where k.id = v_keep and d.id = v_drop;

        update expense_line_items set pricelist_item_id = v_keep where pricelist_item_id = v_drop;
        get diagnostics v_moved = row_count;
        v_lines_moved := v_lines_moved + v_moved;
        update pricelist_item_history set item_id = v_keep where item_id = v_drop;
        update vendor_item_descriptions set pricelist_item_id = v_keep where pricelist_item_id = v_drop;
        delete from pricelist_items where id = v_drop;
        v_offers_merged := v_offers_merged + 1;
      end loop;

      update pricelist_items set pack_size_id = v_target_pack where pack_size_id = v_pack.id;
      delete from item_pack_sizes where id = v_pack.id;
      v_packs_merged := v_packs_merged + 1;
    end if;
  end loop;

  select count(*) into v_offers_moved
  from pricelist_items
  where pack_size_id in (select id from item_pack_sizes where item_id = p_winner);

  -- 3. Carry the losing item's receipt wordings across, dropping any the
  --    winner already knows. Where both remember an offer for the wording and
  --    they differ, it has meant two offers, so it remembers neither. The
  --    loser's own name joins them: it is what the next receipt for this
  --    product is most likely to say.
  update vendor_item_descriptions w
  set pricelist_item_id = case
        when w.pricelist_item_id is null then d.pricelist_item_id
        when d.pricelist_item_id is null or d.pricelist_item_id = w.pricelist_item_id then w.pricelist_item_id
        else null
      end
  from vendor_item_descriptions d
  where w.item_id = p_winner
    and d.item_id = p_loser
    and w.description_normalized = d.description_normalized
    and coalesce(w.vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(d.vendor_id, '00000000-0000-0000-0000-000000000000'::uuid);

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

insert into schema_migrations (filename) values ('0081_brand_offers.sql')
on conflict do nothing;
