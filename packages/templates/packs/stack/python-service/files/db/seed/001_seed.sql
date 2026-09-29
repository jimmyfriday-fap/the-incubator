-- Local and staging seed data only. Never runs against production (APP_ENV=prod skips seeds).
insert into app_meta (key, value) values ('seeded', 'true') on conflict (key) do nothing;
