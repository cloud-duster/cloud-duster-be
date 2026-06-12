# cloud-duster-be

Backend for Cloud Duster, running entirely on **Supabase** (Postgres + Storage +
Edge Functions). The previous Express server (MySQL + NCloud S3) has been
removed.

See [`supabase/README.md`](./supabase/README.md) for the schema, the `api` Edge
Function routes, and deployment instructions.

- **Supabase project:** `txxovjltbbcvlupcjcpx`
- **API base URL:** `https://txxovjltbbcvlupcjcpx.supabase.co/functions/v1/api`
- **Scheduled cleanup:** `pg_cron` job `cleanup-old-memories` (daily, removes
  memories older than 3 days — replaces the old `node-schedule` job).
