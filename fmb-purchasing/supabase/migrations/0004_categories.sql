-- Proposed expense category list (owed per spec §13). Covers kitchen/Thaali
-- operations plus general FMB expense types (events, maintenance, other
-- committees) per §1. Admins can add/rename categories later from the
-- Pricelist page — this is a starting set, not fixed.

insert into categories (name, sort_order) values
  ('Groceries & Provisions', 10),
  ('Meat & Poultry', 20),
  ('Produce (Fruit & Vegetables)', 30),
  ('Dairy & Eggs', 40),
  ('Bakery', 50),
  ('Beverages', 60),
  ('Disposables & Packaging', 70),
  ('Cleaning & Sanitation', 80),
  ('Kitchen Equipment & Utensils', 90),
  ('Gas & Fuel', 100),
  ('Maintenance & Repairs', 110),
  ('Events & Venue', 120),
  ('Transport & Logistics', 130),
  ('Stationery & Printing', 140),
  ('Professional & Contractor Services', 150),
  ('Miscellaneous', 999);
