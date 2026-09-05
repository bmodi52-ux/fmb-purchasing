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
