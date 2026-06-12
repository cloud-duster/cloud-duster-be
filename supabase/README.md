# Cloud Duster — Supabase Backend

The `develop` Express server (MySQL + NCloud S3) has been replaced by Supabase:

| Old (develop)                          | New                                              |
| -------------------------------------- | ------------------------------------------------ |
| Express on Render                      | Edge Function `api` (Deno)                        |
| MySQL (`memory`, `cloud_cleanup_summary`) | Postgres tables of the same shape             |
| NCloud S3 + sharp/heic upload          | Supabase Storage bucket `images` (public)         |
| `node-schedule` daily delete           | `pg_cron` job `cleanup-old-memories` (daily)      |

The REST contract matches what the frontend consumes, so the frontend only needs
a new base URL. Image optimization stays client-side (the frontend already
converts to WebP before upload), so the function just stores the received file.

## Layout

```
supabase/
├── config.toml
├── migrations/
│   ├── 0001_init.sql                    # initial (flyio-shaped) schema
│   └── 0002_rework_to_develop_schema.sql # replaces it with develop's schema
└── functions/
    ├── _shared/cors.ts
    └── api/index.ts
```

## Routes (base: `https://<ref>.supabase.co/functions/v1/api`)

- `GET  /`                              — health check
- `POST /memory`                        — multipart create (image + nickname, message, location, size)
- `GET  /memories?location=&date=&cursorId=&limit=` — list; `date` ∈ `TODAY|YESTERDAY|DBY` (KST)
- `GET  /memories/:id`                  — single memory (flat object)
- `POST /update-photos-deleted-total`   — body `{ count }`, bumps `photos_deleted_count`
- `GET  /cloud-cleanup-summary`         — `{ deletedPhotoCount, peopleCount, avgPhotoSize, totalPhotoSize }`

## Setup / deploy

```bash
brew install supabase/tap/supabase
supabase login
cd cloud-duster-be
supabase link --project-ref <PROJECT_REF>
supabase db push            # applies 0001 then 0002
supabase functions deploy api
```

Frontend: set `VITE_API_URL=https://<PROJECT_REF>.supabase.co/functions/v1/api`
in `cloud-duster-fe/.env.local` (and in your host's env vars), then redeploy.

## Notes vs. the old develop backend

- **`/memories/:id` returns a flat object**, not develop's `{ result: [...] }`.
  The frontend's detail page reads `response.data.location` directly, so the
  wrapped array would have crashed it — this matches the frontend.
- **Stats** keep develop's semantics: each `POST /memory` does
  `people_involved_count += 1` and `total_photo_size += size`;
  `photos_deleted_count` is only changed via `POST /update-photos-deleted-total`.
- **`avgPhotoSize`** is guarded against divide-by-zero (develop returned
  `Infinity` when `photos_deleted_count` was 0).
- **Date filtering** uses the current **KST** calendar day (the userbase is
  Korean); develop relied on the MySQL server's `CURDATE()` timezone.
- **RLS** is enabled with no policies — only the Edge Function (service_role)
  can read/write; the frontend never touches the DB directly.
- The legacy Express files (`app.js`, `package.json`, …) are removed; the
  `/upload` and `/batch/cleanup-old-memories` routes (which existed only on the
  flyio branch, not develop) are intentionally not carried over.
