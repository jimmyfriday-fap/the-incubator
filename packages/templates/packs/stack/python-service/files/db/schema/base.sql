-- Base schema, applied first by `python -m <package>.db` on an empty database.
create table if not exists app_meta (
  key text primary key,
  value text not null
);
