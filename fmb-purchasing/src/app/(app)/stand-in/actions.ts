"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";
import { DUTIES, dutiesHeldThroughTeams, type Duty } from "@/lib/stand-ins";
import { formatRange, isIsoDate } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { reportError } from "@/lib/errors";

export type NominateState = { status: "idle" | "saved" | "error"; message?: string };

/** Names a stand-in for one or both duties between two dates (#35). */
export async function nominateStandIn(_prev: NominateState, formData: FormData): Promise<NominateState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const held = await dutiesHeldThroughTeams(createAdminClient(), user.teamIds);
  const duties = formData.getAll("duty").map(String).filter((d): d is Duty => held.includes(d as Duty));
  const standInId = String(formData.get("stand_in_id") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "");
  const today = todayIso();

  if (held.length === 0) return { status: "error", message: "You don't approve or pay expenses, so there's nothing to cover." };
  if (duties.length === 0) return { status: "error", message: "Choose what your stand-in will cover." };
  if (!standInId || standInId === user.id) return { status: "error", message: "Choose someone else as your stand-in." };
  if (!isIsoDate(startsOn) || !isIsoDate(endsOn)) return { status: "error", message: "Choose both dates." };
  if (endsOn < startsOn) return { status: "error", message: "The last day can't be before the first." };
  if (endsOn < today) return { status: "error", message: "Those dates have already passed." };

  const admin = createAdminClient();
  const { data: standIn } = await admin
    .from("profiles")
    .select("id, full_name, email, is_active")
    .eq("id", standInId)
    .maybeSingle();
  if (!standIn?.is_active) return { status: "error", message: "That person's account isn't active." };

  const { error } = await admin.from("stand_ins").insert(
    duties.map((duty) => ({ user_id: user.id, stand_in_id: standInId, duty, starts_on: startsOn, ends_on: endsOn, created_by: user.id }))
  );
  if (error) {
    await reportError({ source: "stand-ins", error: error.message, userId: user.id });
    return { status: "error", message: "The stand-in couldn't be saved. Try again." };
  }

  const standInName = (standIn.full_name || standIn.email) as string;
  const dutyWords = duties.map((d) => DUTIES.find((x) => x.duty === d)!.label.toLowerCase()).join(" and ");
  const range = formatRange(startsOn, endsOn);

  // A temporary grant of access, recorded with the others (0045).
  await admin.from("access_changes").insert({
    actor_id: user.id,
    kind: "stand_in_nominated",
    subject_id: standInId,
    subject_name: standInName,
    detail: `Covering ${dutyWords} for ${user.fullName || user.email}, ${range}`,
  });

  const admins = await userIdsWithPermission(admin, "admin_users", "manage_users");
  await notify(admin, [
    {
      userId: standInId,
      kind: "stand_in",
      title: `You're standing in for ${user.fullName || user.email}`,
      body: `You'll be ${dutyWords}, ${range}.`,
      link: duties.includes("approve") ? "/approvals" : "/payments",
    },
    ...admins
      .filter((id) => id !== user.id && id !== standInId)
      .map((userId) => ({
        userId,
        kind: "stand_in" as const,
        title: `${standInName} is standing in for ${user.fullName || user.email}`,
        body: `${dutyWords[0].toUpperCase()}${dutyWords.slice(1)}, ${range}.`,
        link: "/admin/teams",
      })),
  ]);

  revalidatePath("/stand-in");
  revalidatePath("/admin/teams");
  return { status: "saved", message: `${standInName} will cover ${dutyWords}, ${range}.` };
}

/** Ends a nomination early, or calls off one that hasn't started. */
export async function cancelStandIn(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = String(formData.get("stand_in_row_id") ?? "");
  if (!id) return;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("stand_ins")
    .select("id, user_id, stand_in_id, duty, starts_on, ends_on, cancelled_at, profiles!stand_ins_stand_in_id_fkey ( full_name, email )")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.cancelled_at || row.user_id !== user.id) return;

  await admin.from("stand_ins").update({ cancelled_at: new Date().toISOString(), cancelled_by: user.id }).eq("id", id);

  const person = row.profiles as unknown as { full_name: string | null; email: string } | null;
  const label = DUTIES.find((d) => d.duty === row.duty)!.label.toLowerCase();
  await admin.from("access_changes").insert({
    actor_id: user.id,
    kind: "stand_in_cancelled",
    subject_id: row.stand_in_id,
    subject_name: person?.full_name || person?.email || null,
    detail: `No longer covering ${label} for ${user.fullName || user.email}`,
  });
  await notify(admin, [
    {
      userId: row.stand_in_id as string,
      kind: "stand_in",
      title: `You're no longer standing in for ${user.fullName || user.email}`,
      body: `${label[0].toUpperCase()}${label.slice(1)} is back with them.`,
      link: "/",
    },
  ]);
  revalidatePath("/stand-in");
}
