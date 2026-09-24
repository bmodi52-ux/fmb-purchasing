-- Prices from a link, the cheapest price wins, sales and brands (#29).
--
-- A vendor's offer can now come from a shop's web page (or a screenshot of
-- one) as well as a shelf photo or a price list. What that needs kept:
--
--   source_url, price_read_at — where the price was read and when. Prices
--     never expire (decided 2026-09-24); the date is shown beside the price
--     so an old one is visible rather than dropped.
--   sale_price, sale_ends_on, sale_end_assumed — a special alongside the
--     regular price in pack_price. The buying list uses the sale price up to
--     and including sale_ends_on and the regular price after, so nobody has
--     to go back and change anything. Costing always uses pack_price.
--     sale_end_assumed marks an end date the page didn't give.
--   gst_basis — how GST was settled, never assumed: 'included' (the price
--     already includes it), 'added' (the page was ex-GST and 10% was added),
--     'free' (no GST on this item). Null for prices from before this.
--
-- vendors.website — the shop's domain, so a link finds its vendor.
-- vendors.quote_gst_basis — the last GST answer given for this shop's
--   prices, offered again next time (still shown and confirmed).
-- items.preferred_brand — when set, costing and the buying list only
--   consider offers of that brand, still at the cheapest store.

alter table pricelist_items
  add column source_url text,
  add column price_read_at timestamptz,
  add column sale_price numeric(12, 4) check (sale_price is null or sale_price > 0),
  add column sale_ends_on date,
  add column sale_end_assumed boolean not null default false,
  add column gst_basis text check (gst_basis in ('included', 'added', 'free'));

alter table vendors
  add column website text,
  add column quote_gst_basis text check (quote_gst_basis in ('included', 'excluded', 'free'));

create unique index vendors_website_key on vendors (lower(website)) where website is not null;

alter table items add column preferred_brand text;

insert into schema_migrations (filename) values ('0076_prices_from_links.sql')
on conflict do nothing;
