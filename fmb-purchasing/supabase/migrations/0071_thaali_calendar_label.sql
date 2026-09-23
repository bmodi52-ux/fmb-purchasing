-- "Thaali menu" becomes "Thaali Calendar" (#19). As in 0065, the key stays
-- `menus`; only what people read changes.

update app_pages set label = 'Thaali Calendar' where key = 'menus';

insert into schema_migrations (filename) values ('0071_thaali_calendar_label.sql')
on conflict do nothing;
