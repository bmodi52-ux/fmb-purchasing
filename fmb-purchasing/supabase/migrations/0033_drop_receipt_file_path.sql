-- The last reader has moved, so the column goes.
--
-- 0028 replaced expenses.receipt_file_path with expense_attachments and
-- deliberately left the column in place: seven files still read it, and
-- Supabase names its columns in strings, so dropping it then would have given
-- a migration that applied cleanly and an application that failed at runtime
-- on pages nobody exercises until someone opens a receipt. Those readers are
-- gone as of this change.
--
-- THE BACKFILL RUNS AGAIN, ON PURPOSE
--
-- 0028's backfill copied every row that existed at that moment. That is not
-- the same as every row that will ever exist, because the deployed application
-- and the database are not upgraded together: production ran the previous
-- release for some time after 0028 was applied, and that release writes
-- receipt_file_path and knows nothing about expense_attachments. Any expense
-- submitted in that window has a receipt the first backfill never saw.
--
-- So this re-runs it for anything still unaccounted for, and only then drops
-- the column. Idempotent: on a database where 0028 caught everything, the
-- insert matches no rows and does nothing.

insert into expense_attachments (
  expense_id, storage_path, file_name, content_type, uploaded_by, sort_order, created_at
)
select
  e.id,
  e.receipt_file_path,
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
where e.receipt_file_path is not null
  -- Not "has no attachments at all": an expense edited under the new release
  -- may have gained other files while still carrying its original path. Match
  -- on the path itself so the original is carried across exactly once.
  and not exists (
    select 1 from expense_attachments a
    where a.expense_id = e.id and a.storage_path = e.receipt_file_path
  );

-- Refuse to drop anything that was not carried across. If this fires, the
-- backfill above is wrong and the receipts it missed would become unreachable
-- the moment the column disappears — there would be nothing left pointing at
-- the objects in storage.
do $$
declare
  orphaned int;
begin
  select count(*) into orphaned
  from expenses e
  where e.receipt_file_path is not null
    and not exists (
      select 1 from expense_attachments a
      where a.expense_id = e.id and a.storage_path = e.receipt_file_path
    );

  if orphaned > 0 then
    raise exception
      'Refusing to drop receipt_file_path: % receipt(s) are not in expense_attachments', orphaned;
  end if;
end $$;

alter table expenses drop column receipt_file_path;
