import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { DUTIES, dutiesHeldThroughTeams, isActive, type StandInRow } from "@/lib/stand-ins";
import { addDays, formatRange } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { SubmitButton } from "@/components/submit-button";
import { cancelStandIn } from "./actions";
import { NominateForm } from "./nominate-form";

export const metadata = { title: "Stand-in" };

/**
 * Away? Name who covers approving or paying, and for which days (#35).
 *
 * Only for people who approve or pay through their teams. A stand-in holds the
 * duty for those days and nothing else, and every nomination is recorded with
 * the other access changes on Teams & permissions.
 */
export default async function StandInPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const today = todayIso();
  const admin = createAdminClient();
  const held = await dutiesHeldThroughTeams(admin, user.teamIds);
  const [{ data: people }, { data: mine }, { data: covering }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").eq("is_active", true).neq("id", user.id).order("full_name"),
    admin
      .from("stand_ins")
      .select("id, user_id, stand_in_id, duty, starts_on, ends_on, cancelled_at")
      .eq("user_id", user.id)
      .gte("ends_on", addDays(today, -60))
      .order("starts_on", { ascending: false }),
    admin
      .from("stand_ins")
      .select("id, user_id, stand_in_id, duty, starts_on, ends_on, cancelled_at")
      .eq("stand_in_id", user.id)
      .is("cancelled_at", null)
      .gte("ends_on", today)
      .order("starts_on"),
  ]);

  const nameIds = [...new Set([...(mine ?? []), ...(covering ?? [])].flatMap((r) => [r.user_id, r.stand_in_id]))];
  const { data: names } = nameIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", nameIds)
    : { data: [] };
  const nameOf = new Map((names ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  const dutyLabel = (duty: string) => DUTIES.find((d) => d.duty === duty)?.label ?? duty;

  const status = (row: StandInRow) =>
    row.cancelled_at ? "Called off" : isActive(row, today) ? "Covering now" : row.starts_on > today ? "Coming up" : "Finished";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">Stand-in</h1>
        <p className="page-description mt-1 max-w-xl">
          Going away? Choose who covers for you and for which days. They can approve or pay only on those days, and
          only what you choose. Admins are told.
        </p>
      </div>

      {(covering ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">You&apos;re standing in</h2>
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-gold/40 bg-gold/5 text-sm">
            {((covering ?? []) as StandInRow[]).map((r) => (
              <li key={r.id} className="px-4 py-2.5">
                {dutyLabel(r.duty)} for {nameOf.get(r.user_id) ?? "someone"} · {formatRange(r.starts_on, r.ends_on)}
                <span className="ml-2 text-xs text-ink/55">{status(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {held.length === 0 ? (
        <p className="text-sm text-ink/60">You don&apos;t approve or pay expenses, so there&apos;s nothing to hand over.</p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="section-title text-ink">Name a stand-in</h2>
          <NominateForm
            duties={DUTIES.filter((d) => held.includes(d.duty)).map((d) => ({ duty: d.duty, label: d.label }))}
            people={(people ?? []).map((p) => ({ id: p.id as string, label: (p.full_name || p.email) as string }))}
            today={today}
            inAWeek={addDays(today, 7)}
          />
        </section>
      )}

      {(mine ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">Your stand-ins</h2>
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {((mine ?? []) as StandInRow[]).map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className={r.cancelled_at || r.ends_on < today ? "text-ink/50" : "text-ink"}>
                  {nameOf.get(r.stand_in_id) ?? "Someone"} · {dutyLabel(r.duty)} · {formatRange(r.starts_on, r.ends_on)}
                  <span className="ml-2 text-xs text-ink/55">{status(r)}</span>
                </span>
                {!r.cancelled_at && r.ends_on >= today && (
                  <form action={cancelStandIn}>
                    <input type="hidden" name="stand_in_row_id" value={r.id} />
                    <SubmitButton pendingLabel="Calling off…" className="text-xs text-maroon/70 underline hover:text-maroon">
                      {isActive(r, today) ? "End now" : "Call off"}
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
