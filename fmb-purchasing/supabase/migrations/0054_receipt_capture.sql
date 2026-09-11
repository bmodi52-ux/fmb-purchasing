-- Receipt capture: supplier defaults, receipts emailed in, and a scheduled
-- check of how well receipts are read (scratchpad #49).

-- ---------------------------------------------------------------------
-- Supplier defaults
-- ---------------------------------------------------------------------
-- What a receipt from this vendor usually is, filled in on Submit when the
-- receipt didn't say otherwise. Null means "as read".

alter table vendors
  add column default_category_id uuid references categories (id) on delete set null,
  -- Who is usually paid: the person who bought it, or the vendor directly.
  add column default_payee text check (default_payee in ('me', 'vendor')),
  -- Whether everything from this vendor is GST-free, or carries GST.
  add column gst_treatment text check (gst_treatment in ('gst_free', 'taxable'));

-- ---------------------------------------------------------------------
-- Receipts emailed in
-- ---------------------------------------------------------------------
-- A member forwards a receipt to the app's address; the whole message is kept
-- as a receipt file (message/rfc822, content-addressed like every upload) and
-- waits on their Submit page until they use or dismiss it.

create table inbound_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  from_email text not null,
  subject text,
  received_at timestamptz not null default now(),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  -- The attachments it carries that can be read, for the list.
  attachment_count int not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'used', 'dismissed')),
  expense_id uuid references expenses (id) on delete set null,
  handled_at timestamptz,
  -- The same message forwarded twice is one receipt.
  unique (user_id, sha256)
);

create index inbound_receipts_waiting_idx on inbound_receipts (user_id, received_at desc) where status = 'waiting';

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in (
    'expense_submitted', 'expense_to_review', 'expense_approved',
    'expense_declined', 'expense_paid',
    'system_error',
    'reminder', 'escalation', 'announcement', 'alert', 'stand_in',
    'receipt_received'
  )
);

-- ---------------------------------------------------------------------
-- The receipt-reading check
-- ---------------------------------------------------------------------
-- Receipts whose correct values someone has confirmed, read again on a
-- schedule so a change of AI model that reads worse is noticed.

create table extraction_benchmark_cases (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  content_type text not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  -- The confirmed values: { vendor?, abn?, invoiceNumber?, date?, subtotal?, gstAmount?, total?, lineCount?, payeeName? }
  expected jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table extraction_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  model text not null,
  case_count int not null,
  checks int not null default 0,
  passed int not null default 0,
  failed_cases int not null default 0,
  -- Per field: { total: { checks, passed }, ... }
  by_field jsonb not null default '{}'::jsonb
);

create unique index extraction_benchmark_one_open_run on extraction_benchmark_runs ((finished_at is null)) where finished_at is null;

create table extraction_benchmark_results (
  run_id uuid not null references extraction_benchmark_runs (id) on delete cascade,
  case_id uuid not null references extraction_benchmark_cases (id) on delete cascade,
  checks jsonb not null default '[]'::jsonb,
  passed int not null default 0,
  total int not null default 0,
  error text,
  read_at timestamptz not null default now(),
  primary key (run_id, case_id)
);

alter table inbound_receipts enable row level security;
alter table extraction_benchmark_cases enable row level security;
alter table extraction_benchmark_runs enable row level security;
alter table extraction_benchmark_results enable row level security;

insert into schema_migrations (filename) values ('0054_receipt_capture.sql')
on conflict do nothing;
