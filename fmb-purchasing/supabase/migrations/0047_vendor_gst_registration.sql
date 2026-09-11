-- Whether a vendor is registered for GST, as the ABR says.
--
-- A business that isn't registered for GST can't charge it, and GST it
-- charges anyway can't be claimed back. The ABN lookup has always been able
-- to say whether a business is registered — the ABR returns it with every
-- lookup — and the app threw that away, keeping only the name.
--
-- Recorded per vendor with when it was checked, so a status read years ago
-- isn't mistaken for today's. The app re-checks a vendor when it has not been
-- checked for 30 days and an expense arrives for it (scratchpad #30).

alter table vendors add column gst_registered boolean;
alter table vendors add column gst_registered_from date;
alter table vendors add column abn_active boolean;
alter table vendors add column abr_checked_at timestamptz;

comment on column vendors.gst_registered is
  'Whether the ABR lists this ABN as registered for GST, as of abr_checked_at. '
  'Null when never checked, or when the vendor has no ABN.';
comment on column vendors.abn_active is
  'False when the ABR lists the ABN as cancelled, as of abr_checked_at.';

insert into schema_migrations (filename) values ('0047_vendor_gst_registration.sql')
on conflict do nothing;
