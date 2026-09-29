-- Base schema, applied first by scripts/db/bootstrap.mjs on an empty database.
create table if not exists app_meta (
  key text primary key,
  value text not null
);
