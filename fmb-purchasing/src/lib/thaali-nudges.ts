import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, userIdsWithPermission, type NotificationEntry } from "@/lib/notifications-inapp";
import { dayLabel, isDue } from "@/lib/thaali-buying";

/** Far enough ahead to catch any vendor's notice; order_lead_days tops out at 30. */
const LOOK_AHEAD_DAYS = 31;

type Row = {
  status: "to_order" | "ordered" | "delivered" | "cancelled";
  owner_id: string | null;
  items: { name: string } | { name: string }[] | null;
  vendors: { order_lead_days: number | null } | { order_lead_days: number | null }[] | null;
  menu_days: { service_date: string } | { service_date: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Each morning, whoever holds something for the thaali that should be ordered
 * by now hears about it once, as one summary (#15). Something nobody holds
 * goes to whoever runs procurement, since it is theirs to hand out.
 *
 * Worked out afresh each day, like the other reminders, so it stops by itself
 * once the things are marked ordered.
 */
export async function runThaaliNudges(admin: SupabaseClient, today: string): Promise<{ nudged: number }> {
  const { data } = await admin
    .from("menu_requirements")
    .select("status, owner_id, items ( name ), vendors ( order_lead_days ), menu_days!inner ( service_date )")
    .eq("status", "to_order")
    .gte("menu_days.service_date", today)
    .lte("menu_days.service_date", shift(today, LOOK_AHEAD_DAYS));
  // Typed by hand: an embedded !inner join widens the generated row type.
  const rows = (data ?? []) as unknown as Row[];

  const due = rows
    .map((r) => ({
      ownerId: r.owner_id,
      itemName: one(r.items)?.name ?? "an item",
      serviceDate: one(r.menu_days)?.service_date ?? "",
      leadDays: one(r.vendors)?.order_lead_days ?? null,
      status: r.status,
    }))
    .filter((line) => line.serviceDate && isDue(line, today));
  if (due.length === 0) return { nudged: 0 };

  const unowned = due.filter((d) => !d.ownerId);
  const byPerson = new Map<string, typeof due>();
  for (const line of due.filter((d) => d.ownerId)) {
    byPerson.set(line.ownerId!, [...(byPerson.get(line.ownerId!) ?? []), line]);
  }
  if (unowned.length > 0) {
    for (const id of await userIdsWithPermission(admin, "procurement", "manage")) {
      byPerson.set(id, [...(byPerson.get(id) ?? []), ...unowned]);
    }
  }

  const entries: NotificationEntry[] = [...byPerson.entries()].map(([userId, lines]) => {
    const earliest = lines.map((l) => l.serviceDate).sort()[0];
    const latest = lines.map((l) => l.serviceDate).sort().at(-1)!;
    const names = [...new Set(lines.map((l) => l.itemName))];
    const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
    return {
      userId,
      kind: "thaali_buying",
      title: `${lines.length} ${lines.length === 1 ? "thing" : "things"} for the thaali should be ordered by now`,
      body: `For ${dayLabel(earliest)}${latest !== earliest ? ` to ${dayLabel(latest)}` : ""}: ${shown}.`,
      link: `/procurement?from=${today}&to=${latest}&status=open`,
    };
  });

  await notify(admin, entries);
  return { nudged: entries.length };
}
