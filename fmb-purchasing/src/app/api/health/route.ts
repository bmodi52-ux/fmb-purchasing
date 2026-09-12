import { createAdminClient } from "@/lib/supabase/admin";
import { migrationStatus } from "@/lib/migrations";

/**
 * Whether the app is up, for an uptime check to call (#46).
 *
 * 200 when the database answers and has every migration this code expects;
 * 503 otherwise. Says nothing more than that — it is public, so an uptime
 * service needs no key — and never caches.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  let database: "ok" | "unreachable" = "ok";
  let migrations: string = "unknown";
  try {
    const status = await migrationStatus(createAdminClient());
    migrations = status.state;
    if (status.state === "unknown") database = "unreachable";
  } catch {
    database = "unreachable";
  }

  const healthy = database === "ok" && migrations === "current";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      migrations,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedInMs: Date.now() - startedAt,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
