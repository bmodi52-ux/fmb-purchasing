-- The page is about the thaali served on a day, and "Menus & dishes" does not
-- say that (#74). The key stays `menus`, since it is what the code and every
-- permission row refer to; only what people read changes.

update app_pages set label = 'Thaali menu' where key = 'menus';

insert into schema_migrations (filename) values ('0065_thaali_menu_label.sql')
on conflict do nothing;
