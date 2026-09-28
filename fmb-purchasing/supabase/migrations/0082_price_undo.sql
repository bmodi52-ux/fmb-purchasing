-- 0082 — withdrawing, declining or editing a receipt puts its offers' prices
-- back as they were, date and source included (#57).
--
-- Since 0078 every newer receipt moves its offer's price date and source to
-- itself, but wrote the undo for it (the `_restore` bookkeeping in the offer's
-- history) only when the price changed. So a receipt that confirmed the price
-- the offer already had left its date behind when it was withdrawn or
-- declined: the item page named a receipt that no longer counted, the old-
-- price flag (#30) read that date, and a genuine receipt dated before it was
-- skipped as older than the current price.
--
-- Editing an expense had the same hole, wider: the edit deletes its lines and
-- writes new ones, and the undo is found by line. The new lines only
-- "confirmed" the price the old ones had set, so withdrawing the edited
-- receipt left even its price behind. And an undo whose earlier source was a
-- deleted line failed on the foreign key.
--
--   price_offers_from_expense — writes the undo every time it moves an
--     offer's date and source; a history entry holding only `_restore` when
--     the price didn't change, which the item page doesn't show.
--   undo_offer_prices(lines) — the one undo: price (when it changed), date
--     and source, stepping back past earlier receipts that no longer count
--     either, and never to a line that no longer exists.
--   restore_offer_prices — withdrawing or declining, through it.
--   write_expense_children — an edit undoes its old lines before replacing
--     them; the app prices the offers from the new lines straight after, as
--     it did.
--   A one-off repair for offers already dated from a receipt that no longer
--   counts (none on live when this was written).

-- ---------------------------------------------------------------------
-- Take an expense's prices onto its offers. As 0078, except that the undo is
-- written whenever the date and source move, not only when the price does.
-- ---------------------------------------------------------------------
create or replace function price_offers_from_expense(p_expense_id uuid)
returns int
language plpgsql
as $$
declare
  r record;
  v_price numeric(12, 4);
  v_count int := 0;
  v_undo jsonb;
begin
  for r in
    select distinct on (l.pricelist_item_id)
      l.id as line_id, l.pricelist_item_id as offer_id, l.line_total, l.quantity,
      coalesce(e.receipt_date, e.created_at::date) as day, e.expense_number,
      o.pack_price, o.price_set_at, o.price_source_line_id
    from expense_line_items l
    join expenses e on e.id = l.expense_id
    join pricelist_items o on o.id = l.pricelist_item_id
    join item_paid_unit_costs p on p.line_item_id = l.id
    where l.expense_id = p_expense_id
      and l.kind = 'goods'
      and not l.not_on_receipt
      and l.line_total > 0
      and l.quantity > 0
      and not p.pack_disagrees
      and e.status not in ('declined', 'withdrawn')
      and o.status <> 'rejected'
    order by l.pricelist_item_id, l.sort_order
  loop
    -- An older receipt is on record as a purchase, but isn't today's price.
    continue when r.price_set_at is not null and r.day < r.price_set_at::date;
    continue when r.price_source_line_id = r.line_id;

    v_price := round(r.line_total / r.quantity, 4);
    update pricelist_items
    set pack_price = v_price, price_set_at = r.day::timestamptz, price_source_line_id = r.line_id
    where id = r.offer_id;

    v_undo := jsonb_build_object('_restore', jsonb_build_object(
      'line_id', r.line_id,
      'previous_price_set_at', r.price_set_at,
      'previous_source_line_id', r.price_source_line_id));

    -- A price that moved shows in the history; the same price seen again
    -- writes only its undo, which the item page doesn't show.
    if r.pack_price is distinct from v_price then
      v_undo := v_undo || jsonb_build_object(
        'pack_price', jsonb_build_object('old', r.pack_price, 'new', v_price),
        'price_source', jsonb_build_object('old', null,
          'new', 'receipt ' || coalesce(r.expense_number, '') || ' of ' || to_char(r.day, 'DD/MM/YYYY')));
    end if;
    insert into pricelist_item_history (item_id, changes) values (r.offer_id, v_undo);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Undo what these receipt lines did to the offers still priced from them.
--
-- Follows the offer's undo entries back from the line its price came from:
-- the price (when that step changed it), the date and the source. Where the
-- earlier source is one of these lines too, or a receipt since withdrawn or
-- declined, it steps back again, so an offer never ends up dated from a
-- receipt that no longer counts. A source line that no longer exists — an
-- expense edited before 0082 — leaves no source rather than failing.
-- ---------------------------------------------------------------------
create or replace function undo_offer_prices(p_line_ids uuid[])
returns int
language plpgsql
as $$
declare
  o record;
  v_changes jsonb;
  v_price numeric(12, 4);
  v_date timestamptz;
  v_line uuid;
  v_label jsonb;
  v_steps int;
  v_count int := 0;
begin
  if coalesce(array_length(p_line_ids, 1), 0) = 0 then
    return 0;
  end if;

  for o in
    select id, pack_price, price_set_at, price_source_line_id
    from pricelist_items
    where price_source_line_id = any(p_line_ids)
    for update
  loop
    v_price := o.pack_price;
    v_date := o.price_set_at;
    v_line := o.price_source_line_id;
    v_label := null;
    v_steps := 0;

    loop
      select h.changes into v_changes
      from pricelist_item_history h
      where h.item_id = o.id
        and h.changes -> '_restore' ->> 'line_id' = v_line::text
      order by h.changed_at desc
      limit 1;
      exit when not found;

      v_steps := v_steps + 1;
      if v_changes ? 'pack_price' then
        v_price := (v_changes -> 'pack_price' ->> 'old')::numeric;
      end if;
      v_label := coalesce(v_label, v_changes -> 'price_source' -> 'new');
      v_date := (v_changes -> '_restore' ->> 'previous_price_set_at')::timestamptz;
      v_line := (v_changes -> '_restore' ->> 'previous_source_line_id')::uuid;

      exit when v_line is null or v_steps >= 100;
      exit when not (
        v_line = any(p_line_ids)
        or exists (
          select 1 from expense_line_items l
          join expenses e on e.id = l.expense_id
          where l.id = v_line and e.status in ('declined', 'withdrawn')
        )
      );
    end loop;
    continue when v_steps = 0;

    if v_line is not null and not exists (select 1 from expense_line_items where id = v_line) then
      v_line := null;
    end if;

    update pricelist_items
    set pack_price = v_price, price_set_at = v_date, price_source_line_id = v_line
    where id = o.id;

    if o.pack_price is distinct from v_price then
      insert into pricelist_item_history (item_id, changes)
      values (o.id, jsonb_build_object(
        'pack_price', jsonb_build_object('old', o.pack_price, 'new', v_price),
        'price_source', jsonb_build_object('old', v_label,
          'new', 'restored: that receipt was declined, withdrawn or edited')));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Withdrawn or declined: undo their lines. Only expenses that really did end
-- up declined or withdrawn, as in 0078.
-- ---------------------------------------------------------------------
create or replace function restore_offer_prices(p_expense_ids uuid[])
returns int
language plpgsql
as $$
begin
  return undo_offer_prices(array(
    select l.id
    from expense_line_items l
    join expenses e on e.id = l.expense_id
    where l.expense_id = any(p_expense_ids)
      and e.status in ('declined', 'withdrawn')
  ));
end;
$$;

-- ---------------------------------------------------------------------
-- write_expense_children: unchanged from 0060 except for the first statement.
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
  -- An edit replaces the lines, and a price undo is found by its line: undo
  -- what the old lines did first (#57). The app prices the offers from the
  -- new lines straight after.
  perform undo_offer_prices(array(select id from expense_line_items where expense_id = p_expense_id));

  delete from expense_line_items where expense_id = p_expense_id;

  insert into expense_line_items (
    expense_id, pricelist_item_id, description_raw, category_id, kind,
    quantity, unit_price, line_subtotal, line_gst, line_total,
    gst_applicable, normalized_quantity, normalized_unit, sort_order, is_capital,
    not_on_receipt, not_on_receipt_note
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
    coalesce((line ->> 'sort_order')::int, ordinality::int - 1),
    coalesce((line ->> 'is_capital')::boolean, false),
    coalesce((line ->> 'not_on_receipt')::boolean, false),
    nullif(line ->> 'not_on_receipt_note', '')
  from jsonb_array_elements(p_lines) with ordinality as t(line, ordinality);

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

revoke all on function undo_offer_prices(uuid[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function undo_offer_prices(uuid[]) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function undo_offer_prices(uuid[]) from authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Offers already dated from a receipt that no longer counts: undo what has an
-- undo, then date the rest from their latest receipt that still counts at the
-- same price. With none, the price has no receipt behind it and was set no
-- later than the offer was last edited (a price edit moves updated_at), so it
-- takes the earlier of that and the date it has.
-- ---------------------------------------------------------------------
select undo_offer_prices(array(
  select l.id
  from expense_line_items l
  join expenses e on e.id = l.expense_id
  where e.status in ('declined', 'withdrawn')
));

with stale as (
  select o.id, o.pack_price
  from pricelist_items o
  join expense_line_items sl on sl.id = o.price_source_line_id
  join expenses se on se.id = sl.expense_id
  where se.status in ('declined', 'withdrawn')
),
fix as (
  select s.id, latest.line_id, latest.day
  from stale s
  left join lateral (
    select l.id as line_id, coalesce(e.receipt_date, e.created_at::date) as day
    from expense_line_items l
    join expenses e on e.id = l.expense_id and e.status not in ('declined', 'withdrawn')
    join item_paid_unit_costs p on p.line_item_id = l.id and not p.pack_disagrees
    where l.pricelist_item_id = s.id
      and l.kind = 'goods'
      and not l.not_on_receipt
      and l.line_total > 0
      and l.quantity > 0
      and round(l.line_total / l.quantity, 4) = s.pack_price
    order by coalesce(e.receipt_date, e.created_at::date) desc, e.created_at desc
    limit 1
  ) latest on true
)
update pricelist_items o
set price_set_at = coalesce(fix.day::timestamptz, least(o.price_set_at, o.updated_at)),
    price_source_line_id = fix.line_id
from fix
where o.id = fix.id;

insert into schema_migrations (filename) values ('0082_price_undo.sql')
on conflict do nothing;
