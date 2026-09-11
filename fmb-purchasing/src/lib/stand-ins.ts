import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stand-ins for a date range (scratchpad #35, migration 0051).
 *
 * The person going away names who covers approving, paying or both between
 * two dates. For those days the stand-in holds exactly the grants that duty
 * needs and nothing more.
 */

export type Duty = "approve" | "pay";

export const DUTIES: { duty: Duty; label: string; grant: [string, string] }[] = [
  { duty: "approve", label: "Approving expenses", grant: ["approvals", "approve"] },
  { duty: "pay", label: "Paying expenses", grant: ["payments", "mark_paid"] },
];

/** The page/action grants a duty carries: its own action, and seeing the page. */
export function grantsForDuty(duty: Duty): `${string}:${string}`[] {
  const [page, action] = DUTIES.find((d) => d.duty === duty)!.grant;
  return [`${page}:${action}`, `${page}:view`];
}

/** Which duty a grant belongs to, if any. */
export function dutyForGrant(page: string, action: string): Duty | null {
  for (const d of DUTIES) {
    const grants = grantsForDuty(d.duty);
    if (grants.includes(`${page}:${action}`)) return d.duty;
  }
  return null;
}

export type StandInRow = {
  id: string;
  user_id: string;
  stand_in_id: string;
  duty: Duty;
  starts_on: string;
  ends_on: string;
  cancelled_at: string | null;
};

/** Whether a nomination is in force on this Sydney calendar day. */
export function isActive(row: Pick<StandInRow, "starts_on" | "ends_on" | "cancelled_at">, today: string): boolean {
  return !row.cancelled_at && row.starts_on <= today && today <= row.ends_on;
}

/**
 * The duties a person holds through their teams — not through standing in for
 * someone else, so a stand-in cannot pass the duty on again.
 */
export async function dutiesHeldThroughTeams(admin: SupabaseClient, teamIds: string[]): Promise<Duty[]> {
  if (teamIds.length === 0) return [];
  const { data } = await admin.from("team_permissions").select("page_key, action_key").in("team_id", teamIds);
  const grants = new Set((data ?? []).map((g) => `${g.page_key}:${g.action_key}`));
  return DUTIES.filter((d) => grants.has(d.grant.join(":"))).map((d) => d.duty);
}

/** Duties someone is standing in for today. */
export async function activeDutiesFor(admin: SupabaseClient, userId: string, today: string): Promise<Duty[]> {
  const { data, error } = await admin
    .from("stand_ins")
    .select("duty")
    .eq("stand_in_id", userId)
    .is("cancelled_at", null)
    .lte("starts_on", today)
    .gte("ends_on", today);
  // Before 0051 has run there is no table; a stand-in grants nothing then.
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r.duty as Duty))];
}

/** Active stand-ins today, with who they cover. */
export async function activeStandIns(admin: SupabaseClient, today: string, duty?: Duty): Promise<StandInRow[]> {
  let query = admin
    .from("stand_ins")
    .select("id, user_id, stand_in_id, duty, starts_on, ends_on, cancelled_at")
    .is("cancelled_at", null)
    .lte("starts_on", today)
    .gte("ends_on", today);
  if (duty) query = query.eq("duty", duty);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as StandInRow[];
}
