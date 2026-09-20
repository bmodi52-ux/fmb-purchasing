-- A dish is portioned into boxes, and a recipe is written for one of them or
-- for a batch that fills a number of them (#70).
--
-- "Per thaali" was the wrong unit: a thaali is several boxes of different
-- sizes, and a recipe is written for the box it goes in — 250 × 650 ml of
-- kadhi is a different recipe from 200 × 1000 ml of pulao, even for the same
-- dish. So a dish now says what size box it fills, and whether its quantities
-- are for one box or for a whole batch of them.

alter table dishes add column portion_ml int;

update dishes set portion_ml = 1000 where portion_ml is null;

alter table dishes alter column portion_ml set not null;
alter table dishes add constraint dishes_portion_ml_positive check (portion_ml > 0);

comment on column dishes.portion_ml is
  'The box this dish is portioned into, in millilitres — 1000, 650, 600, 100.';

-- "thaali" becomes "box", and the batch is counted in boxes rather than in
-- thaalis, which is what the kitchen actually fills.
alter table dishes drop constraint if exists dishes_recipe_basis_check;
alter table dishes drop constraint if exists dishes_batch_size_required;

update dishes set recipe_basis = 'box' where recipe_basis = 'thaali';

alter table dishes rename column batch_thaalis to batch_boxes;

alter table dishes add constraint dishes_recipe_basis_check check (recipe_basis in ('batch', 'box'));
alter table dishes add constraint dishes_batch_size_required
  check (recipe_basis <> 'batch' or batch_boxes is not null);

comment on column dishes.batch_boxes is
  'How many boxes of portion_ml one batch fills. Null on a per-box recipe.';

insert into schema_migrations (filename) values ('0062_dish_box_sizes.sql')
on conflict do nothing;
