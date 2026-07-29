-- The expense detail page reads the whole status history for one expense,
-- which until now meant a sequential scan of the entire table: the audit
-- trail has a foreign key to expenses but never had an index on it.
--
-- Ordered by created_at as well, because every reader wants the trail in
-- order and this lets the sort come from the index.

create index expense_status_history_expense_idx
  on expense_status_history (expense_id, created_at);
