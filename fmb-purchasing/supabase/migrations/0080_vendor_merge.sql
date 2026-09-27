-- 0080 — merge two vendors, and undo it (#44).
--
-- The only vendor merge so far was 0034's one-off pass. Duplicates made
-- since, such as Nimco Foods under two ABNs or a stray "Aldi" beside ALDI
-- STORES, could only be fixed in the database.
--
-- Decided 2026-09-27:
--   * Anyone who can edit vendors can merge.
--   * The vendor number that stays is the one created first, because it is
--     the number already on paper. So the older row always survives; when the
--     vendor chosen to keep is the newer one, its details are copied onto the
--     older row.
--   * Undo, with no time limit. The merge records every row it moved, and
--     undo moves them back. Undo is refused once a new expense has been filed
--     against an offer the merge combined (both stores sold the same pack),
--     because that expense can't be split back between the two.
--
-- The merged-away vendor isn't deleted (undo needs it, and its number): it is
-- marked merged_into, rejected, renamed "… — merged into V-0017" and loses its
-- ABN and website, so nothing matches it any more.

alter table vendors add column merged_into uuid references vendors (id);

comment on column vendors.merged_into is
  'Set when this vendor was merged into another (#44); everything it had moved there. Cleared by an undo.';

create table vendor_merges (
  id uuid primary key default gen_random_uuid(),
  kept_id uuid not null references vendors (id),
  merged_id uuid not null references vendors (id),
  -- The vendor whose details were chosen to keep (either of the two).
  details_from_id uuid not null references vendors (id),
  kept_before jsonb not null,
  merged_before jsonb not null,
  -- { table: [row ids] } for every row moved, and what else changed.
  moved jsonb not null default '{}'::jsonb,
  -- [{ from, into, lines, status }] for offers combined into the kept one.
  combined jsonb not null default '[]'::jsonb,
  merged_by uuid references profiles (id),
  merged_at timestamptz not null default now(),
  undone_by uuid references profiles (id),
  undone_at timestamptz
);

create index vendor_merges_kept_idx on vendor_merges (kept_id);
create index vendor_merges_merged_idx on vendor_merges (merged_id);
alter table vendor_merges enable row level security;

alter table vendor_changes drop constraint vendor_changes_kind_check;
alter table vendor_changes add constraint vendor_changes_kind_check check (kind in (
  'created', 'details_changed', 'usual_settings_changed', 'reviewed',
  'contact_added', 'contact_removed', 'address_added', 'address_removed',
  'bank_account_added', 'bank_details_changed', 'bank_account_replaced',
  'bank_account_proposed', 'bank_account_confirmed', 'bank_account_discarded',
  'gst_registration_changed', 'merged', 'merge_undone'
));

-- ---------------------------------------------------------------------
-- merge_vendors(from, into, actor): merge `from` into `into`, keeping
-- `into`'s details. Returns the merge's id.
-- ---------------------------------------------------------------------
create or replace function merge_vendors(p_from uuid, p_into uuid, p_actor uuid)
returns uuid
language plpgsql
as $$
declare
  v_from vendors;
  v_into vendors;
  v_keep vendors;
  v_gone vendors;
  v_merge uuid;
  v_moved jsonb := '{}'::jsonb;
  v_combined jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_lines uuid[];
  v_target uuid;
  v_keep_payee uuid;
  r record;
begin
  if p_from = p_into then
    raise exception 'A vendor can''t be merged into itself.';
  end if;
  select * into v_from from vendors where id = p_from for update;
  select * into v_into from vendors where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'Vendor not found.';
  end if;
  if v_from.merged_into is not null or v_into.merged_into is not null then
    raise exception 'One of these vendors has already been merged into another.';
  end if;

  -- The older row survives: its number is the one on paper.
  if (v_from.created_at, v_from.id) < (v_into.created_at, v_into.id) then
    v_keep := v_from; v_gone := v_into;
  else
    v_keep := v_into; v_gone := v_from;
  end if;

  insert into vendor_merges (kept_id, merged_id, details_from_id, kept_before, merged_before, merged_by)
  values (v_keep.id, v_gone.id, p_into, to_jsonb(v_keep), to_jsonb(v_gone), p_actor)
  returning id into v_merge;

  -- Free the merged vendor's ABN and website before either can land on the
  -- kept one (both are unique).
  update vendors set abn = null, website = null where id = v_gone.id;

  -- The chosen vendor's details, with the other's filling any gaps.
  update vendors set
    name = v_into.name,
    abn = coalesce(v_into.abn, v_from.abn),
    website = coalesce(v_into.website, v_from.website),
    status = case when v_from.status = 'approved' or v_into.status = 'approved' then 'approved'::entry_status else v_into.status end,
    billing_address = coalesce(v_into.billing_address, v_from.billing_address),
    gst_registered = coalesce(v_into.gst_registered, v_from.gst_registered),
    gst_registered_from = coalesce(v_into.gst_registered_from, v_from.gst_registered_from),
    abn_active = coalesce(v_into.abn_active, v_from.abn_active),
    abr_checked_at = coalesce(v_into.abr_checked_at, v_from.abr_checked_at),
    default_category_id = coalesce(v_into.default_category_id, v_from.default_category_id),
    default_payee = coalesce(v_into.default_payee, v_from.default_payee),
    gst_treatment = coalesce(v_into.gst_treatment, v_from.gst_treatment),
    order_lead_days = coalesce(v_into.order_lead_days, v_from.order_lead_days),
    quote_gst_basis = coalesce(v_into.quote_gst_basis, v_from.quote_gst_basis)
  where id = v_keep.id;

  -- Rows that simply move.
  with moved as (update expenses set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('expenses', to_jsonb(v_ids));

  with moved as (update vendor_collection_addresses set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('addresses', to_jsonb(v_ids));

  with moved as (update vendor_contacts set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('contacts', to_jsonb(v_ids));

  with moved as (update items set preferred_vendor_id = v_keep.id where preferred_vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('items', to_jsonb(v_ids));

  with moved as (update menu_requirements set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('menu_requirements', to_jsonb(v_ids));

  -- Payees: one approved payee per vendor. When both have one, the kept
  -- vendor's stays approved and the other is superseded by it.
  select id into v_keep_payee from payees where vendor_id = v_keep.id and status = 'approved' limit 1;
  if v_keep_payee is not null then
    with superseded as (
      update payees set status = 'superseded', superseded_at = now(), superseded_by = v_keep_payee
      where vendor_id = v_gone.id and status = 'approved' returning id)
    select coalesce(array_agg(id), '{}') into v_ids from superseded;
    v_moved := v_moved || jsonb_build_object('payees_superseded', to_jsonb(v_ids));
  end if;
  with moved as (update payees set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('payees', to_jsonb(v_ids));

  -- Receipt wordings: unique per item, vendor and wording, so a wording the
  -- kept vendor already has is removed (and kept here for an undo).
  v_moved := v_moved || jsonb_build_object('descriptions_removed', coalesce((
    select jsonb_agg(to_jsonb(d)) from vendor_item_descriptions d
    where d.vendor_id = v_gone.id
      and exists (select 1 from vendor_item_descriptions k
                  where k.vendor_id = v_keep.id and k.item_id = d.item_id
                    and k.description_normalized = d.description_normalized)), '[]'::jsonb));
  delete from vendor_item_descriptions d
  where d.vendor_id = v_gone.id
    and exists (select 1 from vendor_item_descriptions k
                where k.vendor_id = v_keep.id and k.item_id = d.item_id
                  and k.description_normalized = d.description_normalized);
  with moved as (update vendor_item_descriptions set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('descriptions', to_jsonb(v_ids));

  -- Offers. The same pack in the same brand from both is one offer now: the
  -- kept vendor's keeps its price, the other's receipt lines move onto it,
  -- and the other is rejected (0078 allows one live offer per store, pack and
  -- brand).
  for r in
    select o.id, o.status, o.pack_size_id, lower(btrim(coalesce(o.brand, ''))) as brand_key
    from pricelist_items o
    where o.vendor_id = v_gone.id and o.status <> 'rejected'
  loop
    select k.id into v_target
    from pricelist_items k
    where k.vendor_id = v_keep.id and k.status <> 'rejected'
      and k.pack_size_id = r.pack_size_id
      and lower(btrim(coalesce(k.brand, ''))) = r.brand_key
    limit 1;
    if v_target is not null then
      with moved as (update expense_line_items set pricelist_item_id = v_target
                     where pricelist_item_id = r.id returning id)
      select coalesce(array_agg(id), '{}') into v_lines from moved;
      update pricelist_items set status = 'rejected' where id = r.id;
      v_combined := v_combined || jsonb_build_array(jsonb_build_object(
        'from', r.id, 'into', v_target, 'lines', to_jsonb(v_lines), 'status', r.status));
    end if;
  end loop;
  with moved as (update pricelist_items set vendor_id = v_keep.id where vendor_id = v_gone.id returning id)
  select coalesce(array_agg(id), '{}') into v_ids from moved;
  v_moved := v_moved || jsonb_build_object('offers', to_jsonb(v_ids));

  -- The merged vendor stays, for undo and its number, but matches nothing.
  update vendors set
    merged_into = v_keep.id,
    status = 'rejected',
    name = v_gone.name || ' — merged into ' || v_keep.vendor_number
  where id = v_gone.id;

  update vendor_merges set moved = v_moved, combined = v_combined where id = v_merge;

  insert into vendor_changes (vendor_id, changed_by, kind, changes) values
    (v_keep.id, p_actor, 'merged', jsonb_build_object('label',
      v_gone.vendor_number || ' ' || v_gone.name || ' was merged into this vendor')),
    (v_gone.id, p_actor, 'merged', jsonb_build_object('label',
      'Merged into ' || v_keep.vendor_number || ' ' || v_into.name));

  return v_merge;
end;
$$;

-- ---------------------------------------------------------------------
-- undo_vendor_merge(merge, actor): put everything back.
-- ---------------------------------------------------------------------
create or replace function undo_vendor_merge(p_merge uuid, p_actor uuid)
returns void
language plpgsql
as $$
declare
  m vendor_merges;
  v_blocking text;
  c jsonb;
  d jsonb;
begin
  select * into m from vendor_merges where id = p_merge for update;
  if m.id is null then raise exception 'Merge not found.'; end if;
  if m.undone_at is not null then raise exception 'This merge has already been undone.'; end if;
  if exists (select 1 from vendor_merges later
             where later.id <> m.id and later.undone_at is null and later.merged_at > m.merged_at
               and m.kept_id in (later.kept_id, later.merged_id)) then
    raise exception 'The vendor has been merged again since. Undo that merge first.';
  end if;

  -- A new expense filed against an offer this merge combined can't be split
  -- back between the two vendors.
  select coalesce(e.expense_number, 'an expense') into v_blocking
  from jsonb_array_elements(m.combined) x
  join expense_line_items l on l.pricelist_item_id = (x ->> 'into')::uuid
  join expenses e on e.id = l.expense_id
  where e.created_at > m.merged_at
  limit 1;
  if v_blocking is not null then
    raise exception 'Can''t undo: % was filed against an offer this merge combined, and it can''t be split back between the two vendors.', v_blocking;
  end if;

  -- The kept vendor's own details first: it may hold the ABN or website the
  -- merged one gets back below.
  update vendors set
    name = m.kept_before ->> 'name',
    abn = m.kept_before ->> 'abn',
    website = m.kept_before ->> 'website',
    status = (m.kept_before ->> 'status')::entry_status,
    billing_address = m.kept_before -> 'billing_address',
    gst_registered = (m.kept_before ->> 'gst_registered')::boolean,
    gst_registered_from = (m.kept_before ->> 'gst_registered_from')::date,
    abn_active = (m.kept_before ->> 'abn_active')::boolean,
    abr_checked_at = (m.kept_before ->> 'abr_checked_at')::timestamptz,
    default_category_id = (m.kept_before ->> 'default_category_id')::uuid,
    default_payee = m.kept_before ->> 'default_payee',
    gst_treatment = m.kept_before ->> 'gst_treatment',
    order_lead_days = (m.kept_before ->> 'order_lead_days')::int,
    quote_gst_basis = m.kept_before ->> 'quote_gst_basis'
  where id = m.kept_id;
  -- jsonb null reads back as the JSON literal null; make it SQL null.
  update vendors set billing_address = null where id = m.kept_id and billing_address = 'null'::jsonb;

  update vendors set
    name = m.merged_before ->> 'name',
    abn = m.merged_before ->> 'abn',
    website = m.merged_before ->> 'website',
    status = (m.merged_before ->> 'status')::entry_status,
    merged_into = null
  where id = m.merged_id;

  -- Offers go back first, then the ones combined get their lines and status.
  update pricelist_items set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'offers')::uuid);
  for c in select * from jsonb_array_elements(m.combined) loop
    update expense_line_items set pricelist_item_id = (c ->> 'from')::uuid
    where id in (select jsonb_array_elements_text(c -> 'lines')::uuid);
    update pricelist_items set status = (c ->> 'status')::entry_status where id = (c ->> 'from')::uuid;
  end loop;

  update expenses set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'expenses')::uuid);
  update vendor_collection_addresses set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'addresses')::uuid);
  update vendor_contacts set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'contacts')::uuid);
  update items set preferred_vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'items')::uuid);
  update menu_requirements set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'menu_requirements')::uuid);
  update payees set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'payees')::uuid);
  update payees set status = 'approved', superseded_at = null, superseded_by = null
  where id in (select jsonb_array_elements_text(coalesce(m.moved -> 'payees_superseded', '[]'::jsonb))::uuid);
  update vendor_item_descriptions set vendor_id = m.merged_id
  where id in (select jsonb_array_elements_text(m.moved -> 'descriptions')::uuid);
  for d in select * from jsonb_array_elements(coalesce(m.moved -> 'descriptions_removed', '[]'::jsonb)) loop
    insert into vendor_item_descriptions
    select * from jsonb_populate_record(null::vendor_item_descriptions, d)
    on conflict do nothing;
  end loop;

  update vendor_merges set undone_at = now(), undone_by = p_actor where id = m.id;

  insert into vendor_changes (vendor_id, changed_by, kind, changes) values
    (m.kept_id, p_actor, 'merge_undone', jsonb_build_object('label',
      'Merge with ' || (m.merged_before ->> 'vendor_number') || ' undone')),
    (m.merged_id, p_actor, 'merge_undone', jsonb_build_object('label',
      'Merge into ' || (m.kept_before ->> 'vendor_number') || ' undone'));
end;
$$;

revoke all on function merge_vendors(uuid, uuid, uuid) from public;
revoke all on function undo_vendor_merge(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function merge_vendors(uuid, uuid, uuid) from anon';
    execute 'revoke all on function undo_vendor_merge(uuid, uuid) from anon';
    execute 'revoke all on table vendor_merges from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function merge_vendors(uuid, uuid, uuid) from authenticated';
    execute 'revoke all on function undo_vendor_merge(uuid, uuid) from authenticated';
    execute 'revoke all on table vendor_merges from authenticated';
  end if;
end;
$$;

insert into schema_migrations (filename) values ('0080_vendor_merge.sql')
on conflict do nothing;
