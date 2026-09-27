-- Habit Tracker — Supabase schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) once,
-- against a fresh project. Safe to re-run: uses `if not exists` guards.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- habits: one row per habit a user is tracking.
-- reminder_hour_utc is the hour (0-23, UTC) the reminder service should
-- nudge the user if they haven't checked in yet that day. The mobile app
-- converts the user's local hour to UTC before writing this.
-- ---------------------------------------------------------------------
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  reminder_hour_utc int not null check (reminder_hour_utc between 0 and 23),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists habits_user_id_idx on habits(user_id);
create index if not exists habits_reminder_hour_idx on habits(reminder_hour_utc) where not archived;

-- ---------------------------------------------------------------------
-- checkins: one row per habit per day it was completed. The unique
-- constraint is what makes "already checked in today?" a single cheap
-- lookup instead of a count/aggregate.
-- ---------------------------------------------------------------------
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_at date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  unique (habit_id, checked_at)
);

create index if not exists checkins_habit_id_idx on checkins(habit_id);
create index if not exists checkins_user_id_idx on checkins(user_id);

-- ---------------------------------------------------------------------
-- push_tokens: one row per user (a user can only be signed into one
-- device for this light version — re-registering overwrites the token).
-- ---------------------------------------------------------------------
create table if not exists push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row Level Security. The mobile app authenticates as the end user and
-- must never see another user's rows. The reminder server instead uses
-- the Supabase *service role* key, which bypasses RLS entirely — that's
-- intentional and is why the service role key must only ever live in the
-- server's environment variables, never in the mobile app.
-- ---------------------------------------------------------------------
alter table habits enable row level security;
alter table checkins enable row level security;
alter table push_tokens enable row level security;

drop policy if exists "habits_select_own" on habits;
create policy "habits_select_own" on habits for select using (auth.uid() = user_id);
drop policy if exists "habits_insert_own" on habits;
create policy "habits_insert_own" on habits for insert with check (auth.uid() = user_id);
drop policy if exists "habits_update_own" on habits;
create policy "habits_update_own" on habits for update using (auth.uid() = user_id);
drop policy if exists "habits_delete_own" on habits;
create policy "habits_delete_own" on habits for delete using (auth.uid() = user_id);

drop policy if exists "checkins_select_own" on checkins;
create policy "checkins_select_own" on checkins for select using (auth.uid() = user_id);
drop policy if exists "checkins_insert_own" on checkins;
create policy "checkins_insert_own" on checkins for insert with check (auth.uid() = user_id);
drop policy if exists "checkins_delete_own" on checkins;
create policy "checkins_delete_own" on checkins for delete using (auth.uid() = user_id);

drop policy if exists "push_tokens_select_own" on push_tokens;
create policy "push_tokens_select_own" on push_tokens for select using (auth.uid() = user_id);
drop policy if exists "push_tokens_insert_own" on push_tokens;
create policy "push_tokens_insert_own" on push_tokens for insert with check (auth.uid() = user_id);
drop policy if exists "push_tokens_update_own" on push_tokens;
create policy "push_tokens_update_own" on push_tokens for update using (auth.uid() = user_id);
