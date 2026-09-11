import { createAdminClient } from "@/lib/supabase/admin";
import { todayIso } from "@/lib/periods-data";
import { runDailyReminders } from "@/lib/reminders";
import { reportError } from "@/lib/errors";
import { ORG_TIME_ZONE } from "@/lib/format";

/**
 * The once-a-day job: reminders and escalation (#27).
 *
 * Vercel's scheduler speaks UTC and Sydney moves an hour for daylight saving,
 * so vercel.json calls this at 21:00 and 22:00 UTC. Whichever call is first at
 * or after 8am Sydney does the work, and scheduled_runs records that today is
 * done so the second call does nothing.
 *
 * Vercel sends CRON_SECRET as a bearer token. Without it set, every call is
 * refused rather than letting anyone on the internet trigger a round of
 * reminders.
 */
export const dynamic = "force-dynamic";

const JOB = "daily";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-AU", { timeZone: ORG_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(new Date())
  );
  if (hour < 8) return Response.json({ skipped: "before 8am in Sydney" });

  const admin = createAdminClient();
  const today = todayIso();

  const { data: last } = await admin.from("scheduled_runs").select("last_run_on").eq("job", JOB).maybeSingle();
  if (last?.last_run_on === today) return Response.json({ skipped: "already ran today" });

  // Claimed before the work, so an overlapping call cannot send the same
  // reminders twice; a failure below is reported, and tomorrow runs as usual.
  await admin.from("scheduled_runs").upsert({ job: JOB, last_run_on: today, last_run_at: new Date().toISOString() });

  try {
    const summary = await runDailyReminders(admin, today);
    await admin.from("scheduled_runs").update({ summary }).eq("job", JOB);
    return Response.json({ ran: today, summary });
  } catch (err) {
    await reportError({ source: "daily-reminders", error: err });
    return Response.json({ failed: (err as Error).message }, { status: 500 });
  }
}
