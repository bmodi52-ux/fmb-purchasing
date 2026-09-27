-- 0079 — the store's own name for a product, on each vendor offer (#43).
--
-- An item is named for the kitchen ("Basmati Rice"), and each store sells it
-- under a name of its own ("Tilda Pure Basmati Rice 10kg"). Decided
-- 2026-09-27: that name belongs on the offer, not on the vendor. When an offer
-- comes from a link or a photo, the name the page or label shows is copied in;
-- anyone editing the offer can change it.

alter table pricelist_items add column store_product_name text;

comment on column pricelist_items.store_product_name is
  'What this store calls the product, e.g. as its website shows it. #43.';

insert into schema_migrations (filename) values ('0079_offer_store_name.sql')
on conflict do nothing;
