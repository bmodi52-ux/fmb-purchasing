-- A submission taken back, rather than deleted.
--
-- Until now a submitter could delete an expense before anyone decided it, and
-- deleting removed everything: the row, its lines, its attachments, and — in
-- application code, since it does not cascade — its status history. A receipt
-- submitted, deleted and submitted again left no trace of the first attempt.
--
-- 'withdrawn' keeps the record and says what happened to it. The next
-- migration uses it; it has to be added alone, because Postgres will not let a
-- new enum value be used in the transaction that adds it (the same reason
-- 0035 stands alone).

alter type expense_status add value if not exists 'withdrawn';

insert into schema_migrations (filename) values ('0043_withdrawn_status.sql')
on conflict do nothing;
