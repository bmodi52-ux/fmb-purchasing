-- The box sizes a dish can be portioned into, as data rather than a list in
-- the code (#70).
--
-- Two sizes are in use — a 1 litre box and a 650 ml box — and the four others
-- the form offered were guesses. Which sizes the kitchen fills is the
-- kitchen's business and will change, so it belongs in a table somebody can
-- edit rather than in a deploy.

create table box_sizes (
  ml int primary key check (ml > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id)
);

comment on table box_sizes is
  'The box sizes offered when a dish says what it is portioned into. A dish keeps whatever size it was given, so removing one here only takes it off the list.';

insert into box_sizes (ml) values (1000), (650)
on conflict do nothing;

-- Any size a dish already uses stays offered, so nothing on an existing menu
-- silently changes shape.
insert into box_sizes (ml)
select distinct portion_ml from dishes
on conflict do nothing;

insert into schema_migrations (filename) values ('0064_box_sizes.sql')
on conflict do nothing;
