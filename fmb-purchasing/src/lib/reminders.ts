import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, type ReminderSettings } from "@/lib/app-settings";
import { notify, userIdsWithPermission, type NotificationEntry } from "@/lib/notifications-inapp";
import { activeStandIns, type Duty } from "@/lib/stand-ins";
import { addDays } from "@/lib/periods";
import { ORG_TIME_ZONE } from "@/lib/format";

/**
 * Daily reminders for things left waiting, then escalation (scratchpad #27).
 *
 * Once a day, at 8am Sydney time, each person with something waiting longer
 * than its limit gets one summary rather than a message per expense: "3
 * expenses waiting for approval, oldest 5 days". If it keeps waiting, someone
 * else is told — the person's stand-in if they have one, otherwise the team
 * an admin chose for that list. A reminder stops by itself as soon as the
 * thing is dealt with, because each day's summary is worked out afresh.
 *
 * The limits live in App settings; how a reminder reaches a person follows
 * their notification settings (#28), and an escalation always arrives by push
 * and email.
 */

/** The Sydney calendar day an instant falls on. */
export function sydneyDay(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant)
  );
}

/** Whole days from `from` to `today`, both Sydney calendar days. */
export function daysBetween(from: string, today: string): number {
  const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((utc(today) - utc(from)) / 86_400_000);
}

export type Waiting = { waitingDays: number };

/** What a list's reminder and escalation would say today, or null for either. */
export function summarise(
  items: Waiting[],
  firstAfterDays: number,
  escalateAfterDays: number
): { remind: { count: number; oldest: number } | null; escalate: { count: number; oldest: number } | null } {
  const due = items.filter((i) => i.waitingDays >= firstAfterDays);
  const over = items.filter((i) => i.waitingDays >= escalateAfterDays);
  const describe = (list: Waiting[]) =>
    list.length ? { count: list.length, oldest: Math.max(...list.map((i) => i.waitingDays)) } : null;
  return { remind: describe(due), escalate: describe(over) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type QueueSpec = {
  name: "approvals" | "payments" | "bankAccounts";
  duty: Duty;
  grant: [string, string];
  link: string;
  noun: string;
  waitingFor: string;
  load: (admin: SupabaseClient) => Promise<string[]>; // instants the items started waiting
};

const QUEUES: QueueSpec[] = [
  {
    name: "approvals",
    duty: "approve",
    grant: ["approvals", "approve"],
    link: "/approvals",
    noun: "expense",
    waitingFor: "waiting for approval",
    load: async (admin) => {
      const { data } = await admin.from("expenses").select("created_at").eq("status", "submitted");
      return (data ?? []).map((r) => r.created_at as string);
    },
  },
  {
    name: "payments",
    duty: "pay",
    grant: ["payments", "mark_paid"],
    link: "/payments",
    noun: "approved expense",
    waitingFor: "not yet paid",
    load: async (admin) => {
      const { data } = await admin.from("expenses").select("decided_at, created_at").eq("status", "approved");
      return (data ?? []).map((r) => (r.decided_at ?? r.created_at) as string);
    },
  },
  {
    name: "bankAccounts",
    duty: "pay",
    grant: ["payments", "mark_paid"],
    link: "/payments",
    noun: "bank account",
    waitingFor: "not yet confirmed",
    load: async (admin) => {
      const { data } = await admin.from("payees").select("created_at").eq("status", "pending");
      return (data ?? []).map((r) => r.created_at as string);
    },
  },
];

async function teamMemberIds(admin: SupabaseClient, teamId: string | null): Promise<string[]> {
  if (!teamId) return [];
  const { data } = await admin.from("team_members").select("user_id").eq("team_id", teamId);
  const ids = (data ?? []).map((m) => m.user_id as string);
  if (ids.length === 0) return [];
  const { data: active } = await admin.from("profiles").select("id").in("id", ids).eq("is_active", true);
  return (active ?? []).map((p) => p.id as string);
}

export type ReminderRunSummary = Record<string, { reminded: number; escalated: number }>;

/** Works out and sends today's reminders. Returns what was sent, for the run log. */
export async function runDailyReminders(admin: SupabaseClient, today: string): Promise<ReminderRunSummary> {
  const settings: ReminderSettings = await getSetting(admin, "reminders");
  const summary: ReminderRunSummary = {};
  if (!settings.enabled) return summary;

  const standIns = await activeStandIns(admin, today);
  const entries: NotificationEntry[] = [];

  for (const queue of QUEUES) {
    const limits = settings[queue.name];
    const started = await queue.load(admin);
    const { remind, escalate } = summarise(
      started.map((s) => ({ waitingDays: daysBetween(sydneyDay(s), today) })),
      limits.firstAfterDays,
      limits.escalateAfterDays
    );
    summary[queue.name] = { reminded: 0, escalated: 0 };
    if (!remind) continue;

    const holders = await userIdsWithPermission(admin, queue.grant[0], queue.grant[1]);
    for (const userId of holders) {
      entries.push({
        userId,
        kind: "reminder",
        title: `${plural(remind.count, queue.noun)} ${queue.waitingFor}`,
        body: `The oldest has waited ${plural(remind.oldest, "day")}.`,
        link: queue.link,
      });
    }
    summary[queue.name].reminded = holders.length;

    if (!escalate) continue;
    // Each holder's stand-in if they have one; if nobody is standing in,
    // the team chosen for this list.
    const escalateTo = new Set(
      standIns.filter((s) => s.duty === queue.duty && holders.includes(s.user_id)).map((s) => s.stand_in_id)
    );
    if (escalateTo.size === 0) for (const id of await teamMemberIds(admin, limits.escalateTeamId)) escalateTo.add(id);
    for (const userId of escalateTo) {
      entries.push({
        userId,
        kind: "escalation",
        title: `${plural(escalate.count, queue.noun)} ${queue.waitingFor} for over ${plural(limits.escalateAfterDays, "day")}`,
        body: `The oldest has waited ${plural(escalate.oldest, "day")}. The usual reminder hasn't moved ${escalate.count === 1 ? "it" : "them"}.`,
        link: queue.link,
      });
    }
    summary[queue.name].escalated = escalateTo.size;
  }

  // Declined and not resubmitted: the submitter, once, on the day it reaches the limit.
  const declinedOn = addDays(today, -settings.declinedAfterDays);
  const { data: declined } = await admin
    .from("expenses")
    .select("id, expense_number, submitted_by, decided_at, vendor_name_raw")
    .eq("status", "declined")
    .gte("decided_at", `${addDays(declinedOn, -1)}T00:00:00Z`)
    .lte("decided_at", `${addDays(declinedOn, 1)}T23:59:59Z`);
  let declinedReminded = 0;
  for (const e of declined ?? []) {
    if (!e.decided_at || sydneyDay(e.decided_at as string) !== declinedOn) continue;
    // A resubmission names what it replaces in its note (getExpenseForResubmit).
    const { count } = e.expense_number
      ? await admin
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("submitted_by", e.submitted_by)
          .ilike("submitter_comment", `%of ${e.expense_number}%`)
      : { count: 0 };
    if ((count ?? 0) > 0) continue;
    entries.push({
      userId: e.submitted_by as string,
      kind: "reminder",
      title: `${e.expense_number ?? "An expense"} is still declined`,
      body: `${e.vendor_name_raw ?? "It"} was declined ${plural(settings.declinedAfterDays, "day")} ago. Fix and resubmit it, or ask the Procurement Head.`,
      link: `/expenses/${e.id}`,
      expenseId: e.id as string,
    });
    declinedReminded++;
  }
  summary.declined = { reminded: declinedReminded, escalated: 0 };

  // New vendors, items and packs: once a week, to whoever approves master data.
  const weekday = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))).getUTCDay();
  summary.masterData = { reminded: 0, escalated: 0 };
  if (weekday === settings.masterDataWeekday) {
    const [vendors, offers, packs] = await Promise.all([
      admin.from("vendors").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("pricelist_items").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("item_pack_sizes").select("id", { count: "exact", head: true }).eq("contents_confirmed", false),
    ]);
    const parts = [
      vendors.count ? plural(vendors.count, "new vendor") : null,
      offers.count ? plural(offers.count, "new item") : null,
      packs.count ? plural(packs.count, "unconfirmed pack") : null,
    ].filter(Boolean);
    if (parts.length) {
      const reviewers = new Set([
        ...(await userIdsWithPermission(admin, "vendors", "approve_master_data")),
        ...(await userIdsWithPermission(admin, "pricelist", "approve_master_data")),
      ]);
      for (const userId of reviewers) {
        entries.push({
          userId,
          kind: "reminder",
          title: "Vendors and Pricelist items to review",
          body: `${parts.join(", ")} waiting on Needs attention.`,
          link: "/review-queue",
        });
      }
      summary.masterData.reminded = reviewers.size;
    }
  }

  await notify(admin, entries);
  return summary;
}
