-- Local and staging seed data only. Never runs against production (bootstrap refuses APP_ENV=prod).
insert into app_meta (key, value) values ('seeded', 'true') on conflict (key) do nothing;
