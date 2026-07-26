-- Extends Vendors per user feedback: sequential vendor number, billing
-- address, multiple collection addresses, multiple contact persons (each
-- with a phone number).

alter table vendors add column vendor_seq int generated always as identity;
alter table vendors add column vendor_number text generated always as ('V-' || lpad(vendor_seq::text, 4, '0')) stored;
alter table vendors add constraint vendors_vendor_number_key unique (vendor_number);

alter table vendors add column billing_address jsonb;
-- billing_address shape: { line1, line2, suburb, state, postcode, country }

create table vendor_collection_addresses (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors (id) on delete cascade,
  label text,
  line1 text not null,
  line2 text,
  suburb text,
  state text,
  postcode text,
  country text not null default 'Australia',
  created_at timestamptz not null default now()
);

create index vendor_collection_addresses_vendor_idx on vendor_collection_addresses (vendor_id);

create table vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors (id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create index vendor_contacts_vendor_idx on vendor_contacts (vendor_id);

alter table vendor_collection_addresses enable row level security;
alter table vendor_contacts enable row level security;
