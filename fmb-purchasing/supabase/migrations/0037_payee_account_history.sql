-- A vendor's bank account can change, and until now there was nowhere to say so.
--
-- 0027 gave every vendor exactly one payee row, enforced by
-- payees_vendor_unique, and everything since has been built on that: the
-- submit form tells a submitter "bank details for Taj Mart are already on
-- file — nothing to enter here", payeeForVendor fills blanks but never
-- overwrites, and the vendor page edits the one row in place. Sound rules,
-- all of them, for the case they were written for: stopping a submitter from
-- silently replacing an account the Treasurer set up.
--
-- The case they were not written for is the ordinary one. Suppliers change
-- banks. When Taj Mart's new invoice carries a different BSB, the submitter
-- reading it has nowhere to put it — the form says there is nothing to enter
-- — and the only route is to find someone with payments:mark_paid and have
-- them type over the old account, destroying the record of what the previous
-- invoices were actually paid into.
--
-- So an account stops being a field on a vendor and becomes a row with a life
-- of its own:
--
--   pending     — somebody has read these details off an invoice
--   approved    — this is the account to pay, at most one per vendor
--   superseded  — this was the account to pay, until it wasn't
--
-- Nothing is edited over and nothing is deleted. An expense keeps pointing at
-- the payee row that was current when it was paid, so "what account did that
-- $5,065.76 actually go to" stays answerable years later — which the previous
-- shape could not answer at all, because the answer was overwritten.
--
-- The unique index moves with it: one *approved* account per vendor, so
-- everything that resolves "the vendor's account" still finds exactly one, and
-- pending proposals can pile up beside it without ambiguity.

alter table payees add column status text not null default 'approved';

alter table payees add constraint payees_status_check
  check (status in ('pending', 'approved', 'superseded'));

-- When it stopped being the account to pay, and what replaced it. Null on
-- everything that is not superseded.
alter table payees add column superseded_at timestamptz;
alter table payees add column superseded_by uuid references payees (id);

alter table payees add constraint payees_superseded_consistent
  check (
    (status = 'superseded' and superseded_at is not null)
    or (status <> 'superseded' and superseded_at is null and superseded_by is null)
  );

comment on column payees.status is
  'approved is the account to pay — at most one per vendor. pending is a set of '
  'details somebody read off an invoice, awaiting confirmation by a holder of '
  'payments:mark_paid. superseded is an account that used to be current and is '
  'kept so paid expenses still say where the money went.';

-- Members are unaffected: a person has one payee record, as before.
--
-- Dropped and replaced rather than added alongside, because the old index
-- would refuse the second row this whole migration exists to allow.
drop index payees_vendor_unique;

create unique index payees_vendor_approved_unique
  on payees (vendor_id)
  where vendor_id is not null and status = 'approved';

-- Every row that exists today is the account in use, which is what the column
-- default already says. Stated anyway so the intent survives a restore from a
-- dump taken before the default was there.
update payees set status = 'approved' where status is null;

-- The Payments page and the payee picker both list live payees; the picker
-- searches by name and neither should offer an account that has been replaced.
create index payees_vendor_status_idx on payees (vendor_id, status)
  where vendor_id is not null;
