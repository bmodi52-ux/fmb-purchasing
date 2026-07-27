-- Adds one level of category nesting so broad categories like "Meat &
-- Poultry" can have specific subcategories (Mutton, Beef, Chicken) that
-- items are actually assigned to, instead of lumping every cut of every
-- animal under one umbrella category and repeating the animal name in
-- every item name (e.g. "Mutton Legs/Shoulders").
--
-- A category with children becomes a display-only grouping node — items
-- (and the AI receipt-extraction category list) are only ever assigned to
-- leaf categories, i.e. categories nobody else points at as a parent.

alter table categories add column parent_category_id uuid references categories (id);

insert into categories (name, sort_order, parent_category_id)
select sub.name, sub.sort_order, parent.id
from (
  values
    ('Mutton', 21),
    ('Beef', 22),
    ('Chicken', 23)
) as sub(name, sort_order)
cross join (select id from categories where name = 'Meat & Poultry') as parent;
