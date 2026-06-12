-- Rework the schema to match the `develop` backend (MySQL + S3 → Supabase).
-- The first migration (0001) created a Mongo/Cloudinary-shaped schema based on
-- the `flyio` branch; `develop` is the canonical backend, so we replace it here.
--
--   develop tables:  memory (singular), cloud_cleanup_summary
--   stats semantics: people_involved_count += 1 and total_photo_size += size per
--                    post; photos_deleted_count bumped via /update-photos-deleted-total

-- Drop the old flyio-based objects -------------------------------------------
do $$
begin
  perform cron.unschedule('cleanup-old-memories');
exception
  when others then null;
end $$;

drop table if exists public.memories cascade;
drop table if exists public.photo_stats cascade;

-- memory (matches develop's `memory` table) ----------------------------------
create table if not exists public.memory (
  id          bigint generated always as identity primary key,
  nickname    text,
  image_url   text        not null,
  message     text,
  location    text        check (location in ('MOUNTAIN', 'OCEAN', 'SKY')),
  size        bigint,
  created_at  timestamptz not null default now()
);

create index if not exists memory_created_at_id_idx
  on public.memory (created_at desc, id desc);

alter table public.memory enable row level security;
-- No policies: only service_role (Edge Functions) may read/write.

-- cloud_cleanup_summary (singleton row, id = 1) ------------------------------
create table if not exists public.cloud_cleanup_summary (
  id                    integer primary key,
  people_involved_count bigint not null default 0,
  total_photo_size      bigint not null default 0,
  photos_deleted_count  bigint not null default 0
);

insert into public.cloud_cleanup_summary (id) values (1)
  on conflict (id) do nothing;

alter table public.cloud_cleanup_summary enable row level security;

-- Daily cleanup: delete memories older than 3 days (replaces develop's
-- node-schedule job). Runs at 00:00 UTC.
select cron.schedule(
  'cleanup-old-memories',
  '0 0 * * *',
  $$ delete from public.memory where created_at < now() - interval '3 days' $$
);
