-- A second view of All expenses: the line items inside it, as one ledger.
--
-- The expense table answers "what did we pay Foodworks". Nothing answered
-- "what did we buy" in a form that could be scanned, sorted and exported —
-- Reports aggregates lines, but a rollup is not a transaction list, so that
-- question was being answered by exporting and pivoting somewhere else.
--
-- This migration exists only because column visibility is stored per page,
-- and user_column_preferences.page_key is a foreign key into app_pages. The
-- ledger shows a different set of columns from the expense table, so it needs
-- its own preference scope; sharing one would have the two views overwrite
-- each other's chosen columns.
--
-- That is *all* it needs. It is not a new permission: the page it lives on is
-- already gated by all_expenses:view, and anyone who can read an expense can
-- read the lines that make it up. Listing it in Teams & permissions would
-- offer an administrator a switch that controls nothing, so app_pages gains a
-- flag saying which rows are permission boundaries and which are only places
-- to remember column choices.

alter table app_pages
  add column is_permission_scope boolean not null default true;

comment on column app_pages.is_permission_scope is
  'False for pages that exist only as a column-preference scope — a second '
  'view of a page that is already permissioned, such as the expense-lines '
  'ledger inside All expenses. The Teams & permissions matrix lists only '
  'rows where this is true, so an administrator is never shown a grant that '
  'decides nothing.';

insert into app_pages (key, label, sort_order, is_permission_scope) values
  ('expense_lines', 'Expense lines', 35, false)
on conflict (key) do nothing;
