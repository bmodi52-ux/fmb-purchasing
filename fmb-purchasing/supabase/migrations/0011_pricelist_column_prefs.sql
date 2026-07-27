-- 0009 renamed the Pricelist price columns (unit_price -> pack_price, and
-- per_unit_cost -> the derived cost_per_unit). Per-user saved column
-- preferences still naming the old keys would silently drop both price
-- columns off the table for anyone who had customised it, so rewrite the
-- stored keys in place.

update user_column_preferences
set visible_columns = (
  select jsonb_agg(
    case
      when key = 'unit_price' then to_jsonb('pack_price'::text)
      when key = 'per_unit_cost' then to_jsonb('cost_per_unit'::text)
      else to_jsonb(key)
    end
    order by ord
  )
  from jsonb_array_elements_text(visible_columns) with ordinality as t(key, ord)
)
where page_key = 'pricelist'
  and visible_columns ?| array['unit_price', 'per_unit_cost'];
