-- Receipts taken on a phone with no signal (scratchpad #47).
--
-- A photo taken offline is kept on the phone and uploaded once it is back
-- online, then waits on the person's Submit page exactly as an emailed-in
-- receipt does (0054). The same table holds both, told apart by source.

alter table inbound_receipts
  add column source text not null default 'email' check (source in ('email', 'phone')),
  add column content_type text not null default 'message/rfc822',
  -- When it was taken, as the phone recorded it; received_at is when it arrived.
  add column captured_at timestamptz;

alter table inbound_receipts alter column from_email drop not null;

alter table inbound_receipts add constraint inbound_receipts_email_has_sender
  check (source <> 'email' or from_email is not null);

insert into schema_migrations (filename) values ('0056_offline_receipts.sql')
on conflict do nothing;
