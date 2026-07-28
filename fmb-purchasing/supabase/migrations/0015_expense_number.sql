-- Every expense gets a stable, human-quotable reference so a submission can
-- be followed from upload through approval to payment, and referred to in
-- conversation or email without anyone pasting a UUID.
--
-- Mirrors the existing vendor_number (V-0001) and item_number (I-0001)
-- pattern: an identity sequence with a formatted, generated text column, so
-- the number is assigned by the database and can never drift from the row.
--
-- Note that identity sequences do not rewind on rollback, so a failed
-- submission consumes a number and the series can contain gaps. That is
-- correct behaviour for an audit reference — a gap is far preferable to two
-- expenses ever sharing E-0007.

alter table expenses add column expense_seq int generated always as identity;

alter table expenses
  add column expense_number text generated always as ('E-' || lpad(expense_seq::text, 4, '0')) stored;

alter table expenses add constraint expenses_expense_number_key unique (expense_number);

create index expenses_expense_number_idx on expenses (expense_number);
