-- What a pack comes in: a box, a bag, a carton.
--
-- Vegetables arrive in boxes of a set weight and are priced per box — a 6 kg
-- box of green chilli at $40. The Pricelist could hold that as "1 × 6 kg" at
-- $40 and work out $6.67/kg, but it had no idea the thing was a box, so it
-- could never say "$40 per box" beside the per-kilo figure. The pack's name
-- ("6 kg box") often said so, but a name is free text and nothing can be
-- priced from it.
--
-- Nullable: a pack nobody has described is still just "a pack". Buying loose
-- stays on sold_loose, which the costing views already read, so a loose pack
-- has no packaging.
--
-- The allowed words are mirrored by PACKAGING in src/lib/pack-description.ts,
-- and src/lib/pack-packaging.test.ts fails if the two drift apart.

alter table item_pack_sizes add column packaging text;

alter table item_pack_sizes add constraint item_pack_sizes_packaging_check
  check (packaging in (
    'box', 'bag', 'sack', 'carton', 'tray', 'punnet',
    'bunch', 'bottle', 'jar', 'tin', 'tub', 'pack'
  ));

-- Existing packs whose name already says what they come in. Outer packaging
-- first — "1L x 10 carton" of bottles is a carton — and each statement only
-- touches packs an earlier one left alone. The same words, in the same order,
-- are what packagingFromText reads off a receipt line.
update item_pack_sizes set packaging = 'carton'
  where packaging is null and not sold_loose and label ~* '\m(cartons?|ctns?|cases?)\M';
update item_pack_sizes set packaging = 'box'
  where packaging is null and not sold_loose and label ~* '\m(box|boxes)\M';
update item_pack_sizes set packaging = 'sack'
  where packaging is null and not sold_loose and label ~* '\msacks?\M';
update item_pack_sizes set packaging = 'bag'
  where packaging is null and not sold_loose and label ~* '\mbags?\M';
update item_pack_sizes set packaging = 'tray'
  where packaging is null and not sold_loose and label ~* '\mtrays?\M';
update item_pack_sizes set packaging = 'punnet'
  where packaging is null and not sold_loose and label ~* '\mpunnets?\M';
update item_pack_sizes set packaging = 'bunch'
  where packaging is null and not sold_loose and label ~* '\m(bunch|bunches)\M';
update item_pack_sizes set packaging = 'tub'
  where packaging is null and not sold_loose and label ~* '\mtubs?\M';
update item_pack_sizes set packaging = 'jar'
  where packaging is null and not sold_loose and label ~* '\mjars?\M';
update item_pack_sizes set packaging = 'tin'
  where packaging is null and not sold_loose and label ~* '\m(tins?|cans?)\M';
update item_pack_sizes set packaging = 'bottle'
  where packaging is null and not sold_loose and label ~* '\m(bottles?|btls?)\M';
update item_pack_sizes set packaging = 'pack'
  where packaging is null and not sold_loose and label ~* '\m(packs?|packets?|pkts?|pk)\M';
