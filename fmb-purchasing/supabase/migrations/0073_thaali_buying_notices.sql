-- Who is told, and when, about thaali buying (#15).
--
-- A released day hands lists to people, and until now nothing told them: the
-- lists sat on the Procurement page until somebody happened to open it.
-- Releasing, and handing a list to somebody else, now notify whoever holds
-- it, and each morning anyone with something that should be ordered by now
-- hears about it.
--
-- "By now" is the vendor's to say. A butcher who needs two days' notice and
-- a grocer who delivers next morning are not the same deadline, so a vendor
-- carries how many days ahead it has to be ordered. Left blank, it is the day
-- before.

alter table vendors add column order_lead_days int check (order_lead_days is null or order_lead_days between 0 and 30);

comment on column vendors.order_lead_days is
  'Days before a thaali day its items must be ordered from this vendor (#15). Null means the day before.';

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in (
    'expense_submitted', 'expense_to_review', 'expense_approved',
    'expense_declined', 'expense_paid',
    'system_error',
    'reminder', 'escalation', 'announcement', 'alert', 'stand_in',
    'receipt_received',
    'thaali_buying'
  )
);

insert into schema_migrations (filename) values ('0073_thaali_buying_notices.sql')
on conflict do nothing;
