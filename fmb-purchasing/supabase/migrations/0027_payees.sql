-- Who actually gets the money.
--
-- The expense record has always known who *submitted* it (submitted_by), who
-- decided it (decided_by) and who marked it paid (paid_by) — but never who
-- the payment goes to. That worked only because the real instruction arrived
-- out of band, in the email that carried the receipt:
--
--   "Please pay Miqdad Bhai as per the attached invoice for Ashara Sehori"
--   "Please pay Huzaifa Bhai as per below email"
--   "Please pay Taj Mart directly $5065.76 as per attached invoices"
--   "These were all paid for by myself, please see reimbursement details —
--    Bank: NAB, Account Name: Ali Abbas Amir, BSB: 082112, ACC: 971464641"
--
-- The submitter is frequently not the payee: one coordinator forwards on
-- behalf of whoever actually paid at the till. Once submissions come through
-- the site instead of email, that instruction has nowhere to live unless the
-- record carries it, and the Treasurer is left guessing who to transfer to.
--
-- One table for every kind of payee rather than three nullable columns on
-- expenses, because the useful thing is reuse: bank details get typed once
-- and are then picked from a list, which is both less work and less
-- opportunity to transpose a digit in an account number.
--
-- Three kinds, distinguished by which link is set:
--   profile_id  — a member being reimbursed for something they paid for
--   vendor_id   — the vendor billed directly ("pay Taj Mart directly")
--   neither     — someone outside the system entirely
--
-- Bank details sit here in the clear, protected the same way every other
-- table in this schema is: default-deny RLS, reachable only through the
-- service role, and surfaced in the UI only to whoever holds
-- payments:mark_paid. That is the same trust boundary that already guards
-- every expense amount and every approval decision in the system.

create table payees (
  id uuid primary key default gen_random_uuid(),

  display_name text not null,

  -- At most one link. A payee is a member, or a vendor, or neither — never
  -- both, which would make "who is this" ambiguous at payment time.
  profile_id uuid references profiles (id) on delete set null,
  vendor_id uuid references vendors (id) on delete set null,

  bank_account_name text,
  bank_bsb text,
  bank_account_number text,

  -- e.g. "pays by PayID", "reimburse via the masjid account"
  notes text,

  is_active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payees_single_link check (profile_id is null or vendor_id is null),
  constraint payees_display_name_not_blank check (btrim(display_name) <> '')
);

-- A member or a vendor has exactly one payee record, so "reimburse me"
-- resolves to the same row every time and bank details are not re-entered.
create unique index payees_profile_unique on payees (profile_id) where profile_id is not null;
create unique index payees_vendor_unique on payees (vendor_id) where vendor_id is not null;

-- The payee picker searches by name.
create index payees_name_idx on payees (lower(display_name));

comment on table payees is
  'Who a reimbursement or payment is made out to. Distinct from expenses.paid_by, '
  'which records the Treasurer who marked the transfer complete.';
comment on column payees.bank_bsb is
  'Australian BSB, stored as entered. Visible only to holders of payments:mark_paid.';

alter table expenses add column payee_id uuid references payees (id);

comment on column expenses.payee_id is
  'Who to pay for this expense. Null on expenses recorded before migration 0027, '
  'and on any expense whose payee has not been chosen yet.';

-- The Payments page groups outstanding expenses by payee (see 0029), which
-- is the query this supports.
create index expenses_payee_idx on expenses (payee_id) where payee_id is not null;

alter table payees enable row level security;
