CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id int REFERENCES users(id),
  state text NOT NULL
);
