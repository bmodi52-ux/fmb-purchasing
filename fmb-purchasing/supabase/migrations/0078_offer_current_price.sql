-- 0078 — one current price per store, pack and brand, kept current by
-- receipts (#46).
--
-- Costing took the cheapest price for an item from any store, and a store
-- could hold two live offers on the same pack: Campbells had the 3 × 5 L
-- cream at $114 (current) and at $98 (July's price), so costing used $6.53/L
-- instead of $7.60. A receipt never updated an offer's price, only filled an
-- empty one, and an offer's date came from updated_at, which any edit moves.
--
-- Decided 2026-09-27:
--   * One live offer per store + pack size + brand, enforced here.
--   * A newer receipt updates the offer's price, logged in its history as
--     coming from that receipt. Not from a line whose pack disagrees, a
--     declined or withdrawn expense, or a credit line. A receipt older than
--     the offer's price is recorded but never becomes current.
--   * The offer records when its price was set (price_set_at), used as the
--     price's date instead of updated_at.
--
-- The pack price a receipt line implies is line_total / quantity: the
-- quantity counts packs, the same reading item_paid_unit_costs makes, and
-- pack_disagrees there is the check that the pack is the right one.

alter table pricelist_items
  add column price_set_at timestamptz,
  add column price_source_line_id uuid references expense_line_items (id) on delete set null;

comment on column pricelist_items.price_set_at is
  'When pack_price was set: the receipt date for a price taken from a receipt, else when it was typed or read. #46.';
comment on column pricelist_items.price_source_line_id is
  'The receipt line the current pack_price came from; null when typed or read from a link. #46.';

-- Existing prices: when read from a link; else, for a price a receipt filled
-- in, that receipt's date; else when the offer last changed. updated_at can
-- be later than the price really is, which only means an older receipt won't
-- displace it here: the conservative side.
update pricelist_items o
set price_set_at = coalesce(
  o.price_read_at,
  (select min(coalesce(e.receipt_date, e.created_at::date))::timestamptz
   from expense_line_items l
   join expenses e on e.id = l.expense_id
   where l.pricelist_item_id = o.id
     and l.quantity > 0
     and round(l.line_total / l.quantity, 4) = o.pack_price),
  o.updated_at)
where o.pack_price is not null;

-- ---------------------------------------------------------------------
-- A price changed by hand, or read from a link, is dated now (or when it was
-- read) and has no receipt behind it. The receipt path sets both columns
-- itself, which this leaves alone.
-- ---------------------------------------------------------------------
create or replace function pricelist_items_date_price()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.pack_price is not null and new.price_set_at is null then
      new.price_set_at := coalesce(new.price_read_at, now());
    end if;
  elsif new.pack_price is distinct from old.pack_price
    and new.price_set_at is not distinct from old.price_set_at
    and new.price_source_line_id is not distinct from old.price_source_line_id then
    if new.pack_price is null then
      new.price_set_at := null;
    elsif new.price_read_at is distinct from old.price_read_at and new.price_read_at is not null then
      new.price_set_at := new.price_read_at;
    else
      new.price_set_at := now();
    end if;
    new.price_source_line_id := null;
  end if;
  return new;
end;
$$;

create trigger pricelist_items_date_price
before insert or update on pricelist_items
for each row execute function pricelist_items_date_price();

-- ---------------------------------------------------------------------
-- Existing duplicates: keep one live offer per store + pack + brand. The
-- keeper is the one with a price, then approved, then the one the latest
-- receipt was filed against. The rest are rejected (not deleted, so nothing
-- that points at them breaks) and their receipt lines move to the keeper,
-- whose price is then left for its latest receipt to set, below.
-- ---------------------------------------------------------------------
do $$
declare
  g record;
  v_keep uuid;
begin
  for g in
    select array_agg(o.id order by (o.pack_price is null), (o.status <> 'approved'),
                     o.latest_receipt desc nulls last, o.updated_at desc, o.created_at desc, o.id) as ids
    from (
      select o.*,
        (select max(coalesce(e.receipt_date, e.created_at::date))
         from expense_line_items l
         join expenses e on e.id = l.expense_id
         where l.pricelist_item_id = o.id and e.status not in ('declined', 'withdrawn')) as latest_receipt
      from pricelist_items o
      where o.status <> 'rejected' and o.vendor_id is not null
    ) o
    group by o.vendor_id, o.pack_size_id, lower(btrim(coalesce(o.brand, '')))
    having count(*) > 1
  loop
    v_keep := g.ids[1];
    update expense_line_items set pricelist_item_id = v_keep where pricelist_item_id = any(g.ids[2:]);
    update pricelist_items set status = 'rejected' where id = any(g.ids[2:]);
    insert into pricelist_item_history (item_id, changes)
    select loser, jsonb_build_object('status', jsonb_build_object('old', 'live', 'new',
      'rejected: a duplicate of another offer from this store on the same pack (0078)'))
    from unnest(g.ids[2:]) as loser;
    update pricelist_items set price_set_at = null where id = v_keep;
  end loop;
end;
$$;

create unique index pricelist_items_one_live_offer
  on pricelist_items (vendor_id, pack_size_id, lower(btrim(coalesce(brand, ''))))
  where status <> 'rejected' and vendor_id is not null;

-- ---------------------------------------------------------------------
-- Take an expense's prices onto its offers. Called after an expense is
-- submitted, edited or reopened. Returns how many offers it priced.
-- ---------------------------------------------------------------------
create or replace function price_offers_from_expense(p_expense_id uuid)
returns int
language plpgsql
as $$
declare
  r record;
  v_price numeric(12, 4);
  v_count int := 0;
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

    -- History only when the price moved; the same price seen again just
    -- moves its date on.
    if r.pack_price is distinct from v_price then
      insert into pricelist_item_history (item_id, changes)
      values (r.offer_id, jsonb_build_object(
        'pack_price', jsonb_build_object('old', r.pack_price, 'new', v_price),
        'price_source', jsonb_build_object('old', null,
          'new', 'receipt ' || coalesce(r.expense_number, '') || ' of ' || to_char(r.day, 'DD/MM/YYYY')),
        '_restore', jsonb_build_object(
          'line_id', r.line_id,
          'previous_price_set_at', r.price_set_at,
          'previous_source_line_id', r.price_source_line_id)));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Undo what these expenses did to prices, when they are declined or
-- withdrawn: an offer still priced from one of their lines goes back to the
-- price it had before. One priced since by a later receipt is left alone.
-- ---------------------------------------------------------------------
create or replace function restore_offer_prices(p_expense_ids uuid[])
returns int
language plpgsql
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select o.id as offer_id, o.pack_price, h.changes
    from pricelist_items o
    join expense_line_items l on l.id = o.price_source_line_id
    -- Only expenses that really did end up declined or withdrawn: a caller
    -- may pass ones another person decided the other way a moment earlier.
    join expenses e on e.id = l.expense_id and e.status in ('declined', 'withdrawn')
    join lateral (
      select changes
      from pricelist_item_history h
      where h.item_id = o.id and h.changes -> '_restore' ->> 'line_id' = l.id::text
      order by h.changed_at desc
      limit 1
    ) h on true
    where l.expense_id = any(p_expense_ids)
  loop
    update pricelist_items
    set pack_price = (r.changes -> 'pack_price' ->> 'old')::numeric,
        price_set_at = (r.changes -> '_restore' ->> 'previous_price_set_at')::timestamptz,
        price_source_line_id = (r.changes -> '_restore' ->> 'previous_source_line_id')::uuid
    where id = r.offer_id;
    insert into pricelist_item_history (item_id, changes)
    values (r.offer_id, jsonb_build_object(
      'pack_price', jsonb_build_object('old', r.pack_price, 'new', r.changes -> 'pack_price' -> 'old'),
      'price_source', jsonb_build_object('old', r.changes -> 'price_source' -> 'new',
        'new', 'restored: that receipt was declined or withdrawn')));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function price_offers_from_expense(uuid) from public;
revoke all on function restore_offer_prices(uuid[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function price_offers_from_expense(uuid) from anon';
    execute 'revoke all on function restore_offer_prices(uuid[]) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function price_offers_from_expense(uuid) from authenticated';
    execute 'revoke all on function restore_offer_prices(uuid[]) from authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Every receipt so far, oldest first, so each offer ends at its latest
-- receipt's price wherever that is newer than the price it had.
-- ---------------------------------------------------------------------
do $$
declare
  e record;
begin
  for e in
    select id from expenses
    where status not in ('declined', 'withdrawn')
    order by coalesce(receipt_date, created_at::date), created_at
  loop
    perform price_offers_from_expense(e.id);
  end loop;
end;
$$;

insert into schema_migrations (filename) values ('0078_offer_current_price.sql')
on conflict do nothing;
