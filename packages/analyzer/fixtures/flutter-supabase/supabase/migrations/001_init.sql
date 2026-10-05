create type public.user_role as enum ('admin', 'organizer', 'member');

create table public.profiles (
  id uuid primary key,
  role public.user_role not null default 'member'
);

create table if not exists public.events (
  id uuid primary key,
  title text not null
);
