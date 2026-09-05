-- Migrations 0026 to 0032, bundled for one paste into the Supabase SQL editor.
--
-- Generated from supabase/migrations. The individual files remain the source
-- of truth and are what the test suite applies; this is only a convenience so
-- that seven files become one action, in the right order, in one transaction.
--
-- Wrapped in a transaction on purpose: if any statement fails, none of it
-- lands, and the database is left exactly as it was rather than half-migrated
-- with no record of how far it got.
--
-- Files bundled, in order:
--   0026_line_kinds_and_line_gst.sql
--   0027_payees.sql
--   0028_attachments_and_fingerprints.sql
--   0029_payment_runs_and_reversals.sql
--   0030_budgets.sql
--   0031_atomic_expense_write.sql
--   0032_signin_attempts.sql

begin;

-- ============================================================
-- 0026_line_kinds_and_line_gst.sql
-- ============================================================

-- Two rules about money that the app previously worked around rather than
-- modelled. Both change what a line item *is*, so they land together.
--
-- 1. THE RECEIPT TOTAL IS AUTHORITATIVE, AND EVERY DOLLAR OF IT SITS ON A LINE
--
-- The submit form used to compute the expense total as the sum of its line
-- items, which meant anything the receipt charged but did not itemise was
-- silently discarded: an Aldi credit-card surcharge of $0.56, a Radhe 10%
-- discount of -$9.20, freight, container deposits, cash rounding. The
-- recorded total then disagreed with the tax invoice, the bank transfer, and
-- the BAS — and the submitter was reimbursed short by exactly the surcharge.
--
-- The naive fix (stop computing the total) would have broken something else.
-- reports/aggregate.ts aggregates at line level and states, correctly, that
-- lines "sum exactly to the expense total, so line totals are a faithful
-- decomposition rather than an approximation". That invariant was true only
-- because the form forced it. Dropping the forcing without replacing it would
-- have left every report quietly under-counting by the charges it never saw.
--
-- So the invariant is kept and the total is captured: the gap is closed by
-- adding the missing line, not by rewriting the total. `kind` is what makes
-- that possible — a charge is a real line, categorised and visible, instead
-- of being smeared across the grocery lines or lost.
--
-- 2. GST IS A PROPERTY OF THE LINE, NOT A SHARE OF THE TOTAL
--
-- Receipt extraction has always inferred gstApplicable per line, and the
-- write path has always thrown it away, replacing it with
-- `line_total / total * gst_amount`. On a receipt that mixes GST-free food
-- with a taxable surcharge — which in this kitchen is most of them — that
-- attributes GST to fresh meat and produce that carry none.
--
-- These receipts state it per line and always have: Foodworks prints
-- "(*) denotes items which attract GST", Aldi flags taxable lines with "A",
-- Campbells has a GST AMT column. Storing the flag lets line GST be computed
-- from it, and unlocks a reconciliation that was previously impossible:
-- sum(line_gst) can now be checked against the GST amount printed on the
-- receipt. Under apportionment that check was circular — line GST was
-- *defined* as a share of the receipt total, so it always agreed with itself
-- no matter how wrong it was.

create type line_item_kind as enum (
  'goods',       -- something bought; the only kind that carries a unit cost
  'surcharge',   -- card surcharge, service fee
  'delivery',    -- freight, delivery, fuel levy
  'discount',    -- always negative
  'rounding',    -- Australian 5c cash rounding, either sign
  'deposit',     -- container/crate deposit, and its refund as a negative
  'unallocated'  -- see below
);

alter table expense_line_items
  add column kind line_item_kind not null default 'goods';

comment on column expense_line_items.kind is
  'What this line represents. Only ''goods'' lines carry a per-unit cost and '
  'belong in price analytics; the rest exist so that the line items add up to '
  'the total printed on the receipt.';

comment on type line_item_kind is
  '''unallocated'' is the escape hatch for a receipt that cannot be itemised — '
  'torn, illegible, a total with no breakdown. It keeps both invariants true '
  '(the total is right, and the lines sum to it) while marking the ambiguity '
  'explicitly, so the remainder surfaces for a person to resolve instead of '
  'being hidden inside a guessed line.';

-- Deliberately nullable. Rows written before this migration had no per-line
-- flag — their line_gst was apportioned from the receipt total — and there is
-- no honest way to infer one after the fact. Null means "this row predates
-- per-line GST"; every row written from here on sets it.
alter table expense_line_items
  add column gst_applicable boolean;

comment on column expense_line_items.gst_applicable is
  'Whether GST applies to this line, read from the receipt. Null on rows '
  'written before migration 0026, whose line_gst was apportioned from the '
  'receipt total rather than derived per line.';

-- Sign rules, as far as they can be stated without over-constraining. A
-- discount is never positive and goods are never negative -- except that a
-- credit line on a wholesale invoice is genuinely negative goods (Campbells
-- invoice 17113 carries -$23.03 and -$92.12), so goods are left unconstrained
-- on purpose. Rounding and deposits legitimately go either way.
alter table expense_line_items
  add constraint expense_line_items_discount_sign
  check (kind <> 'discount' or line_total <= 0);

-- Charges have no pack to cost against, so they must never reach the
-- per-unit analytics. In practice a surcharge line carries no quantity and
-- resolves to no pricelist item, so the existing joins and the `quantity > 0`
-- filter already drop it; the filter is restated against `kind` so that a
-- charge line which somehow acquires both cannot land in a $/kg trend.
--
-- Everything else below is the definition as 0014 left it, reproduced
-- verbatim: `create or replace` cannot add a WHERE clause without restating
-- the whole body, and the column list is unchanged so the dependent
-- item_unit_costs view is undisturbed.
create or replace view item_paid_unit_costs
with (security_invoker = on) as
select
  ips.item_id,
  eli.id            as line_item_id,
  eli.expense_id,
  e.vendor_id,
  e.receipt_date,
  e.created_at      as submitted_at,
  e.status          as expense_status,
  eli.line_total,
  eli.quantity      as normalized_quantity,
  iu.base_unit_code,
  eli.quantity * ips.total_quantity * iu.to_base_factor as base_quantity,
  round(
    eli.line_total / (eli.quantity * ips.total_quantity * iu.to_base_factor),
    4
  )                 as cost_per_base_unit,
  i.name            as item_name,
  ips.contents_confirmed,
  ips.sold_loose
from expense_line_items eli
join expenses e on e.id = eli.expense_id
join pricelist_items o on o.id = eli.pricelist_item_id
join item_pack_sizes ips on ips.id = o.pack_size_id
join items i on i.id = ips.item_id
join units iu on iu.id = ips.inner_unit_id
where eli.kind = 'goods'
  and eli.quantity is not null
  and eli.quantity > 0
  and ips.total_quantity > 0
  and eli.line_total is not null
  and e.status <> 'declined';

-- Reporting cuts by kind (charges excluded from spend-by-item, included in
-- spend-by-vendor), and the reconciliation check reads every line of one
-- expense at once. Both are covered by the existing expense_id index plus
-- this one for the kind filter.
create index expense_line_items_kind_idx on expense_line_items (kind)
  where kind <> 'goods';

-- ============================================================
-- 0027_payees.sql
-- ============================================================

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

-- ============================================================
-- 0028_attachments_and_fingerprints.sql
-- ============================================================

-- One receipt per expense was never quite true in practice.
--
-- A real submission arrives as an invoice *and* a delivery docket; as a
-- two-page invoice photographed twice because it would not fit in one frame;
-- as a receipt plus the covering email that says who to pay. The Fresh
-- Poultry PDF in the receipts folder holds two photographs; one forwarded
-- email holds six separate receipts. `expenses.receipt_file_path` could hold
-- exactly one of those, so everything else was either dropped or stitched
-- into a single oversized PDF that then breached the upload limit.
--
-- This replaces the single path with a proper child table, and takes the
-- opportunity to content-address what gets stored.
--
-- WHY THE HASH MATTERS MORE THAN IT LOOKS
--
-- The upload path writes to storage *before* calling the extraction model,
-- keeps the path whether extraction succeeds or fails, and names the object
-- `<user>/<epoch-millis>-<filename>`. Every retry therefore writes a new
-- object, and an abandoned form leaves it behind with nothing in the database
-- pointing at it — unreachable, uncountable, and permanent.
--
-- Naming the object by the SHA-256 of its bytes makes the retry idempotent:
-- the same photograph re-uploaded overwrites itself instead of accumulating.
-- The same hash then does two more jobs for free. It lets an extraction
-- result be reused rather than re-billed when someone taps upload twice on a
-- slow connection, and it is the strongest duplicate-submission signal
-- available — identical bytes are the same receipt, which is a firmer answer
-- than matching a vendor and an invoice number that a supplier may reuse.

create table expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses (id) on delete cascade,

  -- Object key in the `receipts` bucket. Content-addressed for new uploads;
  -- rows backfilled below keep whatever key they were originally written with.
  storage_path text not null,

  -- What the submitter's device called it, for display. The storage key no
  -- longer carries a usable name once it is a hash.
  file_name text not null,
  content_type text not null,
  size_bytes bigint,

  -- Lowercase hex SHA-256 of the file's bytes. Null on backfilled rows: the
  -- bytes live in storage and could be hashed, but doing so from a migration
  -- would mean pulling every historical receipt through the database.
  sha256 text,

  uploaded_by uuid references profiles (id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  constraint expense_attachments_sha256_hex
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);

create index expense_attachments_expense_idx
  on expense_attachments (expense_id, sort_order);

-- Duplicate detection reads this: "has this exact file already been
-- submitted, on an expense that was not declined?"
create index expense_attachments_sha256_idx
  on expense_attachments (sha256) where sha256 is not null;

comment on table expense_attachments is
  'Files supporting one expense — receipts, invoices, delivery dockets, the '
  'covering email. Replaces the single expenses.receipt_file_path.';

-- Carry the existing single receipts across before the column goes. The
-- original filename is recovered from the tail of the storage key, which is
-- how it was constructed; content_type is inferred from the extension, since
-- it was never recorded.
insert into expense_attachments (
  expense_id, storage_path, file_name, content_type, uploaded_by, sort_order, created_at
)
select
  e.id,
  e.receipt_file_path,
  -- keys are `<uuid>/<epoch>-<sanitised name>`; take the part after the
  -- first hyphen of the last segment, falling back to the whole segment
  coalesce(
    nullif(regexp_replace(split_part(e.receipt_file_path, '/', -1), '^\d+-', ''), ''),
    split_part(e.receipt_file_path, '/', -1)
  ),
  case
    when e.receipt_file_path ilike '%.pdf'  then 'application/pdf'
    when e.receipt_file_path ilike '%.png'  then 'image/png'
    when e.receipt_file_path ilike '%.webp' then 'image/webp'
    else 'image/jpeg'
  end,
  e.submitted_by,
  0,
  e.created_at
from expenses e
where e.receipt_file_path is not null;

-- The column stays for now, deliberately.
--
-- Seven files still read expenses.receipt_file_path — the signed-URL helper,
-- the detail page, and every list that shows a paperclip. None of that is
-- caught by the type checker, because Supabase queries name their columns in
-- strings, so dropping it here would leave a migration that applies cleanly
-- and an application that breaks at runtime on pages nobody exercises until
-- someone opens a receipt.
--
-- Both are true at once until those readers move to expense_attachments: the
-- backfill above copied every existing path, and the app keeps writing this
-- column alongside the new row. It is dropped in the migration that lands
-- with the last reader.
comment on column expenses.receipt_file_path is
  'DEPRECATED — superseded by expense_attachments (0028). Still written and '
  'read while callers migrate; dropped once none remain.';

-- ---------------------------------------------------------------------
-- Duplicate submission signals
-- ---------------------------------------------------------------------
--
-- Deliberately an index and not a unique constraint. A repeated
-- vendor/invoice pair is usually a double submission and occasionally
-- legitimate — a supplier who restarts their numbering each year, a genuine
-- same-day repeat order. Blocking it outright would eventually stop a real
-- expense with no way through; the app warns and lets a person decide.
create index expenses_vendor_invoice_idx
  on expenses (vendor_id, lower(invoice_number))
  where invoice_number is not null and status <> 'declined';

-- ---------------------------------------------------------------------
-- Extraction throttle
-- ---------------------------------------------------------------------
--
-- Receipt extraction is authenticated and permission-gated, so this is not
-- defending against an outsider — there is no self-signup and every caller is
-- a known member. It is a backstop against a client-side retry loop reaching
-- a metered API without limit.
--
-- Same shape as password_reset_attempts (0019), pruned the same way, so there
-- is one throttling pattern in this codebase rather than two.
create table extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index extraction_attempts_user_idx
  on extraction_attempts (user_id, requested_at desc);

alter table expense_attachments enable row level security;
alter table extraction_attempts enable row level security;

-- ============================================================
-- 0029_payment_runs_and_reversals.sql
-- ============================================================

-- One bank transfer, several expenses.
--
-- Today the Treasurer receives an email headed "Please pay Burhanuddin Modi
-- directly $1,819.21" carrying six separate receipts, and makes one transfer.
-- Once each of those receipts is submitted individually — which is what
-- happens when submissions come through the site — the same real payment
-- becomes six expenses, six approvals and six payment records, each needing
-- the same date and reference typed again.
--
-- A payment run is that one transfer: a payee, a date, a reference, and the
-- expenses it settles.
--
-- The per-expense payment_date / payment_reference / paid_by columns stay and
-- are stamped from the run. They are read by the expenses table, the exports
-- and the notifications, and an expense should still be able to answer "when
-- were you paid" without a join. The run is the grouping; the columns remain
-- the record.

create table payment_runs (
  id uuid primary key default gen_random_uuid(),
  payee_id uuid not null references payees (id),
  payment_date date not null,
  payment_reference text,
  -- What the transfer was actually for, when it needs saying.
  note text,
  paid_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create sequence payment_run_seq;

alter table payment_runs
  add column run_number text not null
  default 'PR-' || lpad(nextval('payment_run_seq')::text, 4, '0');

alter table payment_runs add constraint payment_runs_number_key unique (run_number);

create index payment_runs_payee_idx on payment_runs (payee_id, payment_date desc);

comment on table payment_runs is
  'One outgoing bank transfer, settling one or more approved expenses for a '
  'single payee. Grouping only — each expense still records its own payment '
  'date and reference, stamped from the run.';

alter table expenses add column payment_run_id uuid references payment_runs (id) on delete set null;

create index expenses_payment_run_idx on expenses (payment_run_id) where payment_run_id is not null;

-- ---------------------------------------------------------------------
-- Undoing a decision
-- ---------------------------------------------------------------------
--
-- Approve, decline and paid were all terminal, which meant the only way to
-- correct a mistake was to edit the row in the Supabase dashboard — off the
-- record, invisible to the audit trail, and available only to whoever holds
-- the database password.
--
-- No new statuses: a reversal moves the expense back to a status it already
-- has, and the history table (0001) records the transition like any other.
-- That table was designed for exactly this — "additional steps become
-- additional rows rather than a schema change".
--
-- What is new is that a reversal must say why. An approval can be silent
-- because the expense speaks for itself; an unwind cannot, because six months
-- later the only question anyone asks about it is what happened.
alter table expense_status_history
  add column is_reversal boolean not null default false;

comment on column expense_status_history.is_reversal is
  'True when this row moved the expense backwards — unpaid, un-approved, or a '
  'decline reopened. The comment on such a row is mandatory in application code.';

-- ---------------------------------------------------------------------
-- New pages
-- ---------------------------------------------------------------------
--
-- Seeded here rather than created by an admin, so a page can ship with the
-- code that implements it (see the note on app_pages in 0001).
insert into app_pages (key, label, sort_order) values
  ('review_queue', 'Needs attention', 75),
  ('budgets', 'Budgets', 85)
on conflict (key) do nothing;

-- Whoever already approves expenses is who should see what needs a human.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'review_queue', 'view'
from team_permissions tp
where tp.page_key = 'approvals' and tp.action_key = 'approve'
on conflict do nothing;

-- Budgets are set by whoever manages master data, and read by whoever reads
-- reports.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'budgets', 'view'
from team_permissions tp
where tp.page_key = 'reports' and tp.action_key = 'view'
on conflict do nothing;

insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'budgets', 'edit_master_data'
from team_permissions tp
where tp.page_key = 'pricelist' and tp.action_key = 'edit_master_data'
on conflict do nothing;

alter table payment_runs enable row level security;

-- ============================================================
-- 0030_budgets.sql
-- ============================================================

-- Budget versus actual (spec §10), which nothing in the schema has touched
-- until now.
--
-- Deliberately the smallest thing that answers the question people actually
-- ask — "are we over on meat this year?" — rather than a general planning
-- module. One amount, per category, per fiscal year. No monthly phasing, no
-- per-vendor allocations, no draft/approved lifecycle: those are all
-- plausible, none of them have been asked for, and each would need its own
-- UI to be worth the row it sits in.
--
-- The fiscal year is the Hijri one the rest of the app uses (Shawwal through
-- Ramadan — see src/lib/fiscal-year.ts), stored the same
-- way expenses store it: as the integer year its Shawwal falls in.
--
-- Budgets are set against *leaf* categories only. A parent category's budget
-- is the sum of its children, computed rather than stored, so a parent and
-- its children can never disagree about what was budgeted.

create table category_budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete cascade,
  fiscal_year_hijri int not null,

  -- GST-inclusive, matching how expense totals are recorded and how anyone
  -- setting a budget thinks about the number.
  amount numeric(12, 2) not null,

  note text,
  set_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint category_budgets_amount_positive check (amount >= 0),
  constraint category_budgets_unique unique (category_id, fiscal_year_hijri)
);

create index category_budgets_year_idx on category_budgets (fiscal_year_hijri);

comment on table category_budgets is
  'One budgeted amount per leaf category per Hijri fiscal year, GST-inclusive. '
  'A parent category''s budget is the sum of its children and is never stored.';

comment on column category_budgets.fiscal_year_hijri is
  'The Hijri year the fiscal year''s 1 Shawwal falls in — same convention as '
  'expenses.fiscal_year_hijri.';

alter table category_budgets enable row level security;

-- ============================================================
-- 0031_atomic_expense_write.sql
-- ============================================================

-- Writing an expense is one fact, so it should be one transaction.
--
-- It was seven or more. createExpense inserted the parent row, then looped
-- over the line items inserting them one at a time, then inserted the status
-- history row, each as its own PostgREST round trip with its own chance to
-- fail. updateExpense was worse: it deleted every line item and then
-- re-inserted them one by one, so an interruption anywhere in that loop left
-- an expense holding *some* of its lines, with a total that no longer matched
-- them and no indication anything had gone wrong.
--
-- For an accounting record that is the wrong failure mode. It also cost
-- 1 + 2N round trips to a database on the other side of the country, on the
-- one action every submitter performs.
--
-- Moving it into the database buys three things at once: atomicity, a single
-- round trip, and somewhere to enforce the invariant that the rest of the
-- system now depends on — that the line items sum to the recorded total
-- (0026). That check belongs here rather than in the form alone, because the
-- form is not the only thing that can write an expense, and an invariant that
-- reporting relies on should not be enforceable only by the caller that
-- happens to be well-behaved.
--
-- Item and category matching stay in application code and arrive resolved.
-- They involve fuzzy text matching against learned vendor wordings (0023) and
-- have their own tests; reimplementing them in plpgsql would move working,
-- covered logic into a language where it is harder to test for no benefit.

-- Tolerance for the sum check. Not a business allowance — Australian 5c cash
-- rounding prints on the receipt as its own line and is captured as one, so
-- there is nothing legitimate to absorb here. This is float noise only.
create or replace function expense_lines_reconcile(p_lines jsonb, p_total numeric)
returns boolean
language sql
immutable
as $$
  select abs(
    coalesce((
      select sum((line ->> 'line_total')::numeric)
      from jsonb_array_elements(p_lines) as line
    ), 0) - p_total
  ) <= 0.01;
$$;

comment on function expense_lines_reconcile is
  'Whether a set of line items accounts for every dollar of the receipt total. '
  'The 1c tolerance is for floating-point noise, not for unexplained differences.';

-- ---------------------------------------------------------------------
-- Shared line/attachment writer
-- ---------------------------------------------------------------------

create or replace function write_expense_children(
  p_expense_id uuid,
  p_lines jsonb,
  p_attachments jsonb,
  p_uploaded_by uuid
) returns void
language plpgsql
as $$
begin
  delete from expense_line_items where expense_id = p_expense_id;

  insert into expense_line_items (
    expense_id, pricelist_item_id, description_raw, category_id, kind,
    quantity, unit_price, line_subtotal, line_gst, line_total,
    gst_applicable, normalized_quantity, normalized_unit, sort_order
  )
  select
    p_expense_id,
    nullif(line ->> 'pricelist_item_id', '')::uuid,
    line ->> 'description_raw',
    nullif(line ->> 'category_id', '')::uuid,
    coalesce(nullif(line ->> 'kind', ''), 'goods')::line_item_kind,
    (line ->> 'quantity')::numeric,
    (line ->> 'unit_price')::numeric,
    (line ->> 'line_subtotal')::numeric,
    (line ->> 'line_gst')::numeric,
    (line ->> 'line_total')::numeric,
    (line ->> 'gst_applicable')::boolean,
    (line ->> 'normalized_quantity')::numeric,
    nullif(line ->> 'normalized_unit', ''),
    coalesce((line ->> 'sort_order')::int, ordinality::int - 1)
  from jsonb_array_elements(p_lines) with ordinality as t(line, ordinality);

  -- Attachments are replaced wholesale on edit, the same as lines. The files
  -- themselves are content-addressed in storage (0028), so re-writing a row
  -- that names the same object is harmless.
  delete from expense_attachments where expense_id = p_expense_id;

  insert into expense_attachments (
    expense_id, storage_path, file_name, content_type, size_bytes, sha256,
    uploaded_by, sort_order
  )
  select
    p_expense_id,
    att ->> 'storage_path',
    att ->> 'file_name',
    coalesce(nullif(att ->> 'content_type', ''), 'application/octet-stream'),
    (att ->> 'size_bytes')::bigint,
    nullif(att ->> 'sha256', ''),
    p_uploaded_by,
    ordinality::int - 1
  from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) with ordinality as t(att, ordinality);
end;
$$;

-- ---------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------

create or replace function create_expense_with_lines(
  p_submitted_by uuid,
  p_vendor_id uuid,
  p_vendor_name_raw text,
  p_invoice_number text,
  p_receipt_date date,
  p_subtotal numeric,
  p_gst_amount numeric,
  p_total numeric,
  p_submitter_comment text,
  p_payee_id uuid,
  p_fiscal_year_hijri int,
  p_lines jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns table (id uuid, expense_number text)
language plpgsql
as $$
declare
  v_id uuid;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An expense must have at least one line item'
      using errcode = 'check_violation';
  end if;

  if not expense_lines_reconcile(p_lines, p_total) then
    raise exception 'Line items total % but the receipt total is %',
      (select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(p_lines) as line),
      p_total
      using errcode = 'check_violation';
  end if;

  insert into expenses (
    submitted_by, vendor_id, vendor_name_raw, invoice_number, receipt_date,
    subtotal, gst_amount, total, submitter_comment, payee_id,
    status, fiscal_year_hijri
  ) values (
    p_submitted_by, p_vendor_id, p_vendor_name_raw, p_invoice_number, p_receipt_date,
    p_subtotal, p_gst_amount, p_total, p_submitter_comment, p_payee_id,
    'submitted', p_fiscal_year_hijri
  )
  returning expenses.id into v_id;

  perform write_expense_children(v_id, p_lines, p_attachments, p_submitted_by);

  insert into expense_status_history (expense_id, from_status, to_status, actor_id)
  values (v_id, null, 'submitted', p_submitted_by);

  return query
    select e.id, e.expense_number from expenses e where e.id = v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Update (still-editable expenses only)
-- ---------------------------------------------------------------------

create or replace function update_expense_with_lines(
  p_expense_id uuid,
  p_actor uuid,
  p_vendor_id uuid,
  p_vendor_name_raw text,
  p_invoice_number text,
  p_receipt_date date,
  p_subtotal numeric,
  p_gst_amount numeric,
  p_total numeric,
  p_submitter_comment text,
  p_payee_id uuid,
  p_fiscal_year_hijri int,
  p_lines jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns void
language plpgsql
as $$
declare
  v_status expense_status;
  v_owner uuid;
begin
  select status, submitted_by into v_status, v_owner
  from expenses where id = p_expense_id for update;

  if v_owner is null then
    raise exception 'Expense % does not exist', p_expense_id using errcode = 'no_data_found';
  end if;

  -- Re-checked here as well as in the caller. The row is locked above, so
  -- this closes the window between an approver deciding and a submitter
  -- saving an edit they opened beforehand.
  if v_status <> 'submitted' then
    raise exception 'Expense % is % and can no longer be edited', p_expense_id, v_status
      using errcode = 'check_violation';
  end if;
  if v_owner <> p_actor then
    raise exception 'Expense % belongs to someone else', p_expense_id
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An expense must have at least one line item'
      using errcode = 'check_violation';
  end if;

  if not expense_lines_reconcile(p_lines, p_total) then
    raise exception 'Line items total % but the receipt total is %',
      (select sum((line ->> 'line_total')::numeric) from jsonb_array_elements(p_lines) as line),
      p_total
      using errcode = 'check_violation';
  end if;

  update expenses set
    vendor_id = p_vendor_id,
    vendor_name_raw = p_vendor_name_raw,
    invoice_number = p_invoice_number,
    receipt_date = p_receipt_date,
    subtotal = p_subtotal,
    gst_amount = p_gst_amount,
    total = p_total,
    submitter_comment = p_submitter_comment,
    payee_id = p_payee_id,
    fiscal_year_hijri = p_fiscal_year_hijri,
    updated_at = now()
  where id = p_expense_id;

  perform write_expense_children(p_expense_id, p_lines, p_attachments, p_actor);
end;
$$;

-- These run through the service role only, like everything else in this app.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children, expense_lines_reconcile from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function create_expense_with_lines, update_expense_with_lines, write_expense_children, expense_lines_reconcile from authenticated';
  end if;
end $$;

-- ============================================================
-- 0032_signin_attempts.sql
-- ============================================================

-- Failed sign-ins, counted.
--
-- The forgot-password endpoint has had a careful two-ceiling throttle since
-- 0019 — one per address, one per IP, defending against inbox flooding and
-- account enumeration respectively. Sign-in had nothing of our own, relying
-- entirely on whatever the auth provider does by default.
--
-- That is a thin place to leave the door someone would actually try. Passwords
-- here are chosen by their owners and only have to satisfy a length and
-- character rule, so an attacker who knows one address — and addresses are
-- ordinary community ones — has a guessing budget worth capping.
--
-- Same shape and same pruning as password_reset_attempts, deliberately: one
-- throttling pattern in this codebase rather than two.
--
-- Only failures are recorded. A successful sign-in clears the address's
-- history, so somebody who mistypes their password four times and then gets it
-- right is not carrying those four attempts around for the next hour.

create table signin_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Not a foreign key: an attempt against an address with no account is
  -- exactly the case worth counting, and the table must never become a way to
  -- ask which addresses exist.
  email text not null,
  ip text,
  attempted_at timestamptz not null default now()
);

create index signin_attempts_email_idx on signin_attempts (email, attempted_at desc);
create index signin_attempts_ip_idx on signin_attempts (ip, attempted_at desc) where ip is not null;

comment on table signin_attempts is
  'Failed sign-in attempts, for rate limiting. Cleared for an address on '
  'successful sign-in, and pruned past the retention window by the next request.';

alter table signin_attempts enable row level security;

commit;
