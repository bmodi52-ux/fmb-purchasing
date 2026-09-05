-- Verification for the per-unit costing views. Run once, in the SQL editor.
--
-- NOT a migration. Everything is rolled back; the only lasting effect is the
-- sequence rewind at the end, undoing the item/vendor/expense numbers these
-- fixtures consume (Postgres sequences are non-transactional, so ROLLBACK
-- does not return them).
--
-- Only safe while the ledger is empty: the fixtures burn entry numbers, and
-- rewinding a sequence that real rows depend on would hand out duplicates.
-- Check `select count(*) from expenses` is 0 before running.
--
-- These two formulas produce every cost figure the app reports, and neither
-- has ever been checked against a database:
--
--   offer_unit_costs      pack_price / (total_quantity * to_base_factor)
--   item_paid_unit_costs  line_total / (quantity * total_quantity * to_base_factor)
--
-- The second is the one 0014 was written to fix. Before it, a line was
-- divided by the quantity the receipt happened to state, so 12 cartons of 30
-- eggs at $720 reported $60 an egg instead of $2.00. Case 1 pins exactly that.

begin;

do $$
declare
  v_cat        uuid;
  v_vendor     uuid;
  v_profile    uuid;
  v_ea         uuid;
  v_kg         uuid;
  v_g          uuid;
  v_ml         uuid;

  v_item       uuid;
  v_pack       uuid;
  v_offer      uuid;
  v_expense    uuid;

  v_actual     numeric;
  v_base       numeric;
  v_count      bigint;
  v_confirmed  boolean;


  v_base_unit  text;
begin
  select id into v_profile from profiles limit 1;
  select id into v_cat     from categories where name = 'Miscellaneous';
  select id into v_ea      from units where code = 'ea';
  select id into v_kg      from units where code = 'kg';
  select id into v_g       from units where code = 'g';
  select id into v_ml      from units where code = 'mL';

  if v_profile is null or v_cat is null or v_ea is null then
    raise exception 'Fixtures missing: need a profile, the Miscellaneous category and the seeded units';
  end if;

  if (select count(*) from expenses) > 0 then
    raise exception 'Ledger is not empty — this script burns entry numbers and must not run against real data';
  end if;

  insert into vendors (name, status) values ('__verify_costing__', 'approved')
  returning id into v_vendor;

  -- =================================================================
  -- Case 1: 12 cartons x 30 eggs, $720. The 0014 regression case.
  -- =================================================================
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_eggs__', v_ea, v_cat) returning id into v_item;

  -- one carton = 30 ea
  insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, contents_confirmed)
  values (v_item, 30, v_ea, 1, 'Carton of 30', true) returning id into v_pack;

  insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
  values (v_pack, v_vendor, 60, 'approved') returning id into v_offer;

  -- 1a. list price per egg, from the offer
  select cost_per_base_unit into v_actual from offer_unit_costs where offer_id = v_offer;
  if v_actual <> 2.0000 then
    raise exception 'offer_unit_costs: expected 2.0000/ea for $60 per carton of 30, got %', v_actual;
  end if;
  raise notice 'PASS 1a  offer  $60 / carton of 30      = %/ea', v_actual;

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-01', 720, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Eggs 30s', 12, 720);

  -- 1b. paid cost per egg: 12 cartons x 30 = 360 eggs, not 12 units
  select base_quantity, cost_per_base_unit into v_base, v_actual
  from item_paid_unit_costs where item_id = v_item;

  if v_base <> 360 then
    raise exception 'item_paid_unit_costs: expected base_quantity 360 eggs, got %', v_base;
  end if;
  if v_actual <> 2.0000 then
    raise exception 'item_paid_unit_costs: expected 2.0000/egg, got % (60.0000 means it divided by the receipt quantity — the 0014 bug is back)', v_actual;
  end if;
  raise notice 'PASS 1b  paid   $720 / (12 x 30)        = %/ea  (base_quantity %)', v_actual, v_base;

  -- =================================================================
  -- Case 2: 80 kg loose mutton, $1320
  -- =================================================================
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_mutton__', v_kg, v_cat) returning id into v_item;

  insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, sold_loose, contents_confirmed)
  values (v_item, 1, v_kg, 1, 'Loose, per kg', true, true) returning id into v_pack;

  insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
  values (v_pack, v_vendor, 16.5, 'approved') returning id into v_offer;

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-02', 1320, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Mutton', 80, 1320);

  select cost_per_base_unit into v_actual from item_paid_unit_costs where item_id = v_item;
  if v_actual <> 16.5000 then
    raise exception 'Loose mutton: expected 16.5000/kg, got %', v_actual;
  end if;
  raise notice 'PASS 2   paid   $1320 / 80 kg loose     = %/kg', v_actual;

  -- =================================================================
  -- Case 3: grams convert to kg via to_base_factor 0.001
  --         4 x 500 g packs, $20  ->  2 kg  ->  $10.00/kg
  -- =================================================================
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_spice__', v_kg, v_cat) returning id into v_item;

  insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, contents_confirmed)
  values (v_item, 500, v_g, 1, '500 g pack', true) returning id into v_pack;

  insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
  values (v_pack, v_vendor, 5, 'approved') returning id into v_offer;

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-03', 20, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Spice 500g', 4, 20);

  select base_quantity, cost_per_base_unit, base_unit_code
    into v_base, v_actual, v_base_unit
  from item_paid_unit_costs where item_id = v_item;

  if v_base <> 2 or v_actual <> 10.0000 or v_base_unit <> 'kg' then
    raise exception 'Gram pack: expected 2 kg at 10.0000/kg, got % % at %', v_base, v_base_unit, v_actual;
  end if;
  raise notice 'PASS 3   paid   $20 / (4 x 500 g)       = %/%  (base_quantity %)', v_actual, v_base_unit, v_base;

  -- =================================================================
  -- Case 4: millilitres, and pack_count > 1
  --         3 x (4 x 250 mL) = 3 L, $18  ->  $6.00/L
  -- =================================================================
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_oil__', (select id from units where code = 'L'), v_cat) returning id into v_item;

  insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, contents_confirmed)
  values (v_item, 250, v_ml, 4, '250 mL x 4', true) returning id into v_pack;

  insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
  values (v_pack, v_vendor, 6, 'approved') returning id into v_offer;

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-04', 18, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Oil 250ml x4', 3, 18);

  select base_quantity, cost_per_base_unit, base_unit_code
    into v_base, v_actual, v_base_unit
  from item_paid_unit_costs where item_id = v_item;

  if v_base <> 3 or v_actual <> 6.0000 or v_base_unit <> 'L' then
    raise exception 'mL pack: expected 3 L at 6.0000/L, got % % at %', v_base, v_base_unit, v_actual;
  end if;
  raise notice 'PASS 4   paid   $18 / (3 x 4 x 250 mL)  = %/%  (base_quantity %)', v_actual, v_base_unit, v_base;

  -- =================================================================
  -- Case 5: item_unit_costs aggregates across purchases
  --         second egg purchase at $2.20/egg, later date
  -- =================================================================
  select ips.id into v_pack
  from item_pack_sizes ips join items i on i.id = ips.item_id
  where i.name = '__verify_eggs__';
  select o.id into v_offer from pricelist_items o where o.pack_size_id = v_pack;
  select i.id into v_item from items i where i.name = '__verify_eggs__';

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-20', 396, 1447)
  returning id into v_expense;

  -- 6 cartons x 30 = 180 eggs, $396 -> $2.20/egg
  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Eggs 30s', 6, 396);

  select purchase_count, avg_cost_per_base_unit, latest_cost_per_base_unit
    into v_count, v_actual, v_base
  from item_unit_costs where item_id = v_item;

  if v_count <> 2 then
    raise exception 'item_unit_costs: expected 2 purchases, got %', v_count;
  end if;
  if v_actual <> 2.1000 then
    raise exception 'item_unit_costs: expected avg 2.1000 of (2.00, 2.20), got %', v_actual;
  end if;
  -- latest is by receipt_date desc, so the 20 August purchase
  if v_base <> 2.2000 then
    raise exception 'item_unit_costs: expected latest 2.2000 (20 Aug), got %', v_base;
  end if;
  raise notice 'PASS 5   agg    % purchases, avg %/ea, latest %/ea', v_count, v_actual, v_base;

  -- =================================================================
  -- Case 6: unconfirmed pack contents are flagged, not hidden
  -- =================================================================
  insert into items (name, canonical_unit_id, category_id)
  values ('__verify_unconfirmed__', v_ea, v_cat) returning id into v_item;

  -- a placeholder created from a receipt: nobody has said what one unit holds
  insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, contents_confirmed)
  values (v_item, 1, v_ea, 1, 'Unconfirmed', false) returning id into v_pack;

  insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
  values (v_pack, v_vendor, 10, 'approved') returning id into v_offer;

  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'approved', date '2026-08-05', 100, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Mystery box', 10, 100);

  select all_contents_confirmed into v_confirmed
  from item_unit_costs where item_id = v_item;

  if v_confirmed is not false then
    raise exception 'Unconfirmed pack: expected all_contents_confirmed false, got %', v_confirmed;
  end if;
  raise notice 'PASS 6   flag   unconfirmed contents surfaced as %', v_confirmed;

  -- =================================================================
  -- Case 7: declined expenses are excluded from paid costs
  -- =================================================================
  insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
  values (v_profile, v_vendor, 'declined', date '2026-08-06', 999, 1447)
  returning id into v_expense;

  insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
  values (v_expense, v_offer, 'Mystery box', 1, 999);

  select count(*) into v_count
  from item_paid_unit_costs where expense_id = v_expense;

  if v_count <> 0 then
    raise exception 'Declined expense: expected 0 rows in item_paid_unit_costs, got %', v_count;
  end if;
  raise notice 'PASS 7   filter declined expense contributes % rows', v_count;

  raise notice '--- all costing checks passed ---';
end $$;

rollback;

-- Return the entry numbers the fixtures consumed. Safe only because the
-- ledger was empty; the DO block above refuses to run otherwise.
alter table items    alter column item_seq    restart with 1;
alter table vendors  alter column vendor_seq  restart with 1;
alter table expenses alter column expense_seq restart with 1;

-- Every count must be 0.
select (select count(*) from items)    as items,
       (select count(*) from vendors)  as vendors,
       (select count(*) from expenses) as expenses;
