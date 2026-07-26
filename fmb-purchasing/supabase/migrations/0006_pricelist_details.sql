-- Extends Pricelist per user feedback: sequential item number (mirrors
-- vendor_number), pack size, brand, unit price, per-unit cost, comments,
-- an extensible units picklist, optional vendor, and a full change log.

create table units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into units (code, label, sort_order) values
  ('ea', 'ea', 10),
  ('kg', 'kg', 20),
  ('g', 'g', 30),
  ('L', 'L', 40),
  ('mL', 'mL', 50),
  ('carton', 'Carton', 60);

alter table pricelist_items add column item_seq int generated always as identity;
alter table pricelist_items add column item_number text generated always as ('I-' || lpad(item_seq::text, 4, '0')) stored;
alter table pricelist_items add constraint pricelist_items_item_number_key unique (item_number);

-- items can now exist without a vendor
alter table pricelist_items alter column vendor_id drop not null;
alter table pricelist_items drop constraint pricelist_items_vendor_id_description_key;

alter table pricelist_items add column pack_size numeric(12, 3);
alter table pricelist_items add column pack_size_unit_id uuid references units (id);
alter table pricelist_items add column brand text;
alter table pricelist_items add column unit_price numeric(12, 4);
alter table pricelist_items add column unit_price_unit_id uuid references units (id);
alter table pricelist_items add column per_unit_cost numeric(12, 4);
alter table pricelist_items add column per_unit_cost_unit_id uuid references units (id);
alter table pricelist_items add column comments text;
alter table pricelist_items add column updated_at timestamptz not null default now();
alter table pricelist_items add column updated_by uuid references profiles (id);

create table pricelist_item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references pricelist_items (id) on delete cascade,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now(),
  changes jsonb not null default '{}'::jsonb
);

create index pricelist_item_history_item_idx on pricelist_item_history (item_id);

alter table units enable row level security;
alter table pricelist_item_history enable row level security;
