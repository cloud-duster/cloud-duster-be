-- Cloud Duster: initial schema, storage bucket, stats, and scheduled cleanup.
-- All application access goes through the `api` Edge Function using the
-- service_role key, so RLS is enabled with no public policies (deny direct
-- anon/PostgREST access) while the functions bypass RLS.

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id          bigint generated always as identity primary key,
  nickname    text        not null default '익명의 먼지',
  image_url   text        not null,
  message     text        not null,
  location    text        not null check (location in ('MOUNTAIN', 'OCEAN', 'SKY')),
  size        bigint      not null,
  created_at  timestamptz not null default now()
);

-- Keyset pagination order: newest first. id is monotonic with created_at,
-- so (created_at desc, id desc) collapses to (id desc).
create index if not exists memories_created_at_id_idx
  on public.memories (created_at desc, id desc);

alter table public.memories enable row level security;
-- No policies on purpose: only service_role (Edge Functions) may touch rows.

-- ---------------------------------------------------------------------------
-- photo_stats (singleton row)
-- ---------------------------------------------------------------------------
create table if not exists public.photo_stats (
  id                  boolean primary key default true,
  deleted_photo_count bigint  not null default 0,
  people_count        bigint  not null default 0,
  total_photo_size    bigint  not null default 0,
  constraint photo_stats_singleton check (id)
);

insert into public.photo_stats (id) values (true)
  on conflict (id) do nothing;

alter table public.photo_stats enable row level security;

-- ---------------------------------------------------------------------------
-- Storage bucket for memory images (public read so <img> URLs resolve)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Scheduled cleanup: delete memories older than 3 days (replaces the old
-- POST /batch/cleanup-old-memories cron endpoint). Runs daily at 00:00 UTC.
-- Requires the pg_cron extension (enable in Dashboard > Database > Extensions
-- if this CREATE EXTENSION is not permitted during db push).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('cleanup-old-memories');
exception
  when others then null; -- job did not exist yet
end $$;

select cron.schedule(
  'cleanup-old-memories',
  '0 0 * * *',
  $$ delete from public.memories where created_at < now() - interval '3 days' $$
);
