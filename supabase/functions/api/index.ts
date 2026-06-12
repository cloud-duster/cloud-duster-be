// Cloud Duster API — single Edge Function replacing the develop Express server
// (MySQL + NCloud S3). Routes mirror develop's contract, with images stored in
// Supabase Storage and the response shapes the frontend actually consumes.
//
// Invoked at: https://<ref>.supabase.co/functions/v1/api/<path>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const BUCKET = "images";
const VALID_LOCATIONS = ["MOUNTAIN", "OCEAN", "SKY"];
const DEFAULT_LIMIT = 10;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000; // KST is UTC+9, no DST

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Start of a KST calendar day (offset from today), as a UTC ISO timestamp.
function seoulDayStartISO(offsetDays: number): string {
  const seoulNow = new Date(Date.now() + SEOUL_OFFSET_MS);
  const dayStartUtcMidnight = Date.UTC(
    seoulNow.getUTCFullYear(),
    seoulNow.getUTCMonth(),
    seoulNow.getUTCDate() + offsetDays,
  );
  return new Date(dayStartUtcMidnight - SEOUL_OFFSET_MS).toISOString();
}

// Upload an image File to Storage and return its public URL.
async function uploadImage(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.\-]/g, "_") || "image";
  const path = `${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "image/webp",
      upsert: false,
    });
  if (error) throw error;

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";

  try {
    // GET / — health check
    if (req.method === "GET" && path === "/") {
      return new Response("Hello, Supabase", { headers: corsHeaders });
    }

    // POST /memory — create a memory (image upload + insert + stats)
    if (req.method === "POST" && path === "/memory") {
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File)) {
        return json({ msg: "No file uploaded" }, 400);
      }

      const nickname = (form.get("nickname") as string) ?? null;
      const message = (form.get("message") as string) ?? null;
      const location = (form.get("location") as string) ?? null;
      const size = Number(form.get("size") ?? 0);
      // Number of photos the user deleted (frontend sends this as `amount`).
      const amount = Number(form.get("amount") ?? 0);

      if (location && !VALID_LOCATIONS.includes(location)) {
        return json({ msg: "Invalid location" }, 400);
      }

      // Bump the running totals: +1 person, += size, += deleted-photo count.
      const { data: summary } = await supabase
        .from("cloud_cleanup_summary")
        .select("people_involved_count, total_photo_size, photos_deleted_count")
        .eq("id", 1)
        .single();
      if (summary) {
        await supabase
          .from("cloud_cleanup_summary")
          .update({
            people_involved_count: Number(summary.people_involved_count) + 1,
            total_photo_size: Number(summary.total_photo_size) + size,
            photos_deleted_count:
              Number(summary.photos_deleted_count) + amount,
          })
          .eq("id", 1);
      }

      const imageUrl = await uploadImage(file);

      const { error: insertError } = await supabase
        .from("memory")
        .insert({ nickname, image_url: imageUrl, message, location, size });
      if (insertError) throw insertError;

      return json({ msg: "Memory added" }, 201);
    }

    // GET /memories/:id — single memory (flat object, as the frontend expects)
    const idMatch = path.match(/^\/memories\/(\d+)$/);
    if (req.method === "GET" && idMatch) {
      const { data, error } = await supabase
        .from("memory")
        .select("*")
        .eq("id", Number(idMatch[1]))
        .single();
      if (error || !data) return json({ msg: "Memory not found" }, 404);
      return json(data);
    }

    // GET /memories — list with location/date/cursor filters
    if (req.method === "GET" && path === "/memories") {
      const location = url.searchParams.get("location");
      const date = url.searchParams.get("date");
      const cursorId = url.searchParams.get("cursorId");
      const limit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);

      let query = supabase
        .from("memory")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      // Date filter relative to the current KST calendar day.
      if (date === "TODAY") {
        query = query.gte("created_at", seoulDayStartISO(0));
      } else if (date === "YESTERDAY") {
        query = query
          .gte("created_at", seoulDayStartISO(-1))
          .lt("created_at", seoulDayStartISO(0));
      } else if (date === "DBY") {
        query = query
          .gte("created_at", seoulDayStartISO(-2))
          .lt("created_at", seoulDayStartISO(-1));
      }

      if (location) query = query.eq("location", location);
      if (cursorId) query = query.lt("id", Number(cursorId));

      const { data, error } = await query;
      if (error) throw error;

      const rows = data ?? [];
      const last = rows[rows.length - 1];
      const nextCursor = last
        ? { createdAt: last.created_at, id: last.id }
        : null;

      return json({ items: rows, nextCursor });
    }

    // GET /cloud-cleanup-summary — computed stats
    if (req.method === "GET" && path === "/cloud-cleanup-summary") {
      const { data: s, error } = await supabase
        .from("cloud_cleanup_summary")
        .select("*")
        .eq("id", 1)
        .single();
      if (error || !s) throw error ?? new Error("summary not found");

      const deletedPhotoCount = Number(s.photos_deleted_count);
      const totalPhotoSize = Number(s.total_photo_size);
      // Guard against divide-by-zero (develop returned Infinity here).
      const avgPhotoSize = deletedPhotoCount > 0
        ? totalPhotoSize / deletedPhotoCount
        : 0;

      return json({
        deletedPhotoCount,
        peopleCount: Number(s.people_involved_count),
        avgPhotoSize,
        totalPhotoSize,
      });
    }

    return json({ msg: "Not found" }, 404);
  } catch (error) {
    console.error("API error:", error);
    return json({ msg: "Internal server error", error: String(error) }, 500);
  }
});
