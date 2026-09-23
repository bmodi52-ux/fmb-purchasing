-- Offers left pending on items that were rejected (#16).
--
-- Rejecting an item only changed the item, so its offers still waiting for
-- review stayed in the Pricelist's "Pending review" table. From now on
-- rejecting the item rejects them too; this does the same for the items
-- rejected before that. Approved offers are left alone, as the app leaves
-- them. On live this was one offer: DRY-0006's, from Campbells Northmead.

update pricelist_items o
set status = 'rejected',
    reviewed_by = i.reviewed_by,
    reviewed_at = coalesce(i.reviewed_at, now())
from item_pack_sizes p
join items i on i.id = p.item_id
where o.pack_size_id = p.id
  and o.status = 'pending'
  and i.status = 'rejected';

insert into schema_migrations (filename) values ('0070_rejected_item_offers.sql')
on conflict do nothing;
