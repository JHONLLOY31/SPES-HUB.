-- =====================================================================
-- SPES Hub  |  Step 4: create the tables  (Supabase / PostgreSQL)
--
-- HOW TO RUN
--   1. Open your Supabase project.
--   2. Click "SQL Editor" in the left menu, then "New query".
--   3. Paste this whole file and click "Run".
--   4. At the bottom you should see a list of 13 tables.
--
-- It is wrapped in BEGIN / COMMIT: if any line fails, NOTHING is created,
-- so you can fix the problem and run it again from the top.
--
-- Row Level Security (RLS) is switched ON for every table, with no rules yet.
-- That means nobody can read or write these tables through the website until
-- Step 5 adds the access rules. This is intentional and safe.
-- =====================================================================

begin;

-- The program runs on Philippine time, but the server clock is UTC.
-- Every "today" in this database goes through this function.
create or replace function public.ph_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Manila')::date $$;


-- ---------------------------------------------------------------------
-- 1. batches: one row per batch room (B1 - 2026, B2 - 2026, ...)
-- ---------------------------------------------------------------------
create table public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,                       -- e.g. B1-2026 (used when registering)
  year        integer not null default extract(year from public.ph_today())::integer,
  start_date  date not null default public.ph_today(),    -- only a fallback; each person's Day 1 is their own start_date
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. profiles: one row per person (beneficiary, office head, administrator)
--    The login itself lives in Supabase's built-in auth.users table.
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  spes_id       text unique,                               -- e.g. B1-2026-0001 (made by the register function in Step 6)
  name          text not null,
  gender        text check (gender in ('Male', 'Female')),
  username      text not null,
  role          text not null default 'beneficiary' check (role in ('admin', 'head', 'beneficiary')),
  batch_id      uuid references public.batches (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  start_date    date not null default public.ph_today(),  -- Day 1 = the day they registered
  avatar_path   text,                                      -- file path in the photo storage bucket
  avatar_frame  text not null default 'gold' check (avatar_frame in ('none', 'gold', 'champion', 'spark', 'pulse', 'checker', 'star')),
  note_text     text check (char_length(note_text) <= 60), -- Messenger-style note
  note_at       timestamptz,                               -- the note disappears 24 hours after this time
  settings      jsonb not null default '{}'::jsonb,        -- theme, language, sound
  created_at    timestamptz not null default now()
);
create unique index profiles_username_lower_key on public.profiles (lower(username));
create index profiles_batch_idx on public.profiles (batch_id);


-- ---------------------------------------------------------------------
-- 3. attendance: one photo per person, per day, per slot
--    submitted_at uses the SERVER clock, so changing a phone's time does nothing.
-- ---------------------------------------------------------------------
create table public.attendance (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  work_date     date not null default public.ph_today(),
  slot          text not null check (slot in ('AM_IN', 'AM_OUT', 'PM_IN', 'PM_OUT')),
  photo_path    text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  on_time       boolean not null default true,
  submitted_at  timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  unique (user_id, work_date, slot)
);
create index attendance_day_idx on public.attendance (work_date, status);


-- ---------------------------------------------------------------------
-- 4. manual_present: days the administrator marked as present without a photo
-- ---------------------------------------------------------------------
create table public.manual_present (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  work_date   date not null,
  marked_by   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, work_date)
);


-- ---------------------------------------------------------------------
-- 5. journals: the daily journal (one entry per person per day)
--    If your journal screen has other fields, add the columns here.
-- ---------------------------------------------------------------------
create table public.journals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  work_date   date not null,
  entry       text not null check (char_length(entry) <= 2000),
  photo_path  text,
  created_at  timestamptz not null default now(),
  unique (user_id, work_date)
);


-- ---------------------------------------------------------------------
-- 6. game_questions: what players SEE (no answers in this table)
--    kind: choice (multiple choice / true-false), type, memory, search, color
-- ---------------------------------------------------------------------
create table public.game_questions (
  id        uuid primary key default gen_random_uuid(),
  room      integer not null check (room between 1 and 20),
  position  integer not null,
  kind      text not null default 'choice' check (kind in ('choice', 'type', 'memory', 'search', 'color')),
  question  text,
  prompt    text,
  options   jsonb,                                         -- answer choices, memory symbols or search words
  unique (room, position)
);

-- 7. game_answers: the answer key. Players can never read this table;
--    only the answer-check and the password-protected admin function (Step 6) use it.
create table public.game_answers (
  question_id    uuid primary key references public.game_questions (id) on delete cascade,
  correct_index  integer,                                  -- for multiple choice
  correct_text   text                                      -- for typed answers
);


-- ---------------------------------------------------------------------
-- 8. game_progress: points and answers per person, per game room
-- ---------------------------------------------------------------------
create table public.game_progress (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  room        integer not null check (room between 1 and 20),
  points      integer not null default 0,
  answered    jsonb not null default '[]'::jsonb,
  completed   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, room)
);


-- ---------------------------------------------------------------------
-- 9. notifications: to one person, or to all staff
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete cascade,
  for_staff   boolean not null default false,
  message     text not null,
  kind        text not null default 'info',
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  check (user_id is not null or for_staff)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);


-- ---------------------------------------------------------------------
-- 10. announcements: batch_id empty means "for everyone"
-- ---------------------------------------------------------------------
create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  batch_id    uuid references public.batches (id) on delete cascade,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 11. feedback: messages from beneficiaries, with an optional reply
-- ---------------------------------------------------------------------
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  message     text not null check (char_length(message) <= 2000),
  reply       text,
  replied_by  uuid references public.profiles (id) on delete set null,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 12. activity_log: who did what, and when
-- ---------------------------------------------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  action      text not null,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 13. answer_key: the password that protects the admin "Game answers" page
--     Exactly one row (id is always 1). Only the hash is stored.
-- ---------------------------------------------------------------------
create table public.answer_key (
  id             smallint primary key default 1 check (id = 1),
  password_hash  text not null,
  failed_tries   integer not null default 0,
  locked_until   timestamptz,
  updated_at     timestamptz not null default now()
);

-- "Who is online" does not need a table: Step 11 uses Supabase Realtime presence.


-- ---------------------------------------------------------------------
-- Lock every table until Step 5 adds the access rules
-- ---------------------------------------------------------------------
alter table public.batches        enable row level security;
alter table public.profiles       enable row level security;
alter table public.attendance     enable row level security;
alter table public.manual_present enable row level security;
alter table public.journals       enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_answers   enable row level security;
alter table public.game_progress  enable row level security;
alter table public.notifications  enable row level security;
alter table public.announcements  enable row level security;
alter table public.feedback       enable row level security;
alter table public.activity_log   enable row level security;
alter table public.answer_key     enable row level security;

commit;


-- ---------------------------------------------------------------------
-- CHECK (run these two lines after the script above, as a separate run):
--   select table_name from information_schema.tables where table_schema = 'public' order by 1;
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- You should see 13 tables and rowsecurity = true on all of them.
-- ---------------------------------------------------------------------
