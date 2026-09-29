-- Numbered migrations run in order exactly once; applied names are recorded in _migrations.
insert into app_meta (key, value) values ('schema', '1') on conflict (key) do update set value = excluded.value;
