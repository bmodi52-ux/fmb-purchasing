import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Alert rules admins build from set parts (scratchpad #28, migration 0050):
 * when something happens, only if it matches, tell these people.
 *
 *   when      an expense is submitted / approved / paid, a vendor is added,
 *             or a category's budget passes a percentage
 *   only if   the amount is at least, the expense has a line in these
 *             categories, the vendor is one of these
 *   tell      teams and people
 *
 * Matching is pure and tested; runAlertRules reads the rules, resolves who to
 * tell and sends through the ordinary notification path, so each person's own
 * settings for "Alerts" still decide how it reaches them.
 */

import { ALERT_EVENTS, type AlertEvent } from "@/lib/alert-events";

export { ALERT_EVENTS, type AlertEvent };

export type AlertConditions = {
  minAmount?: number | null;
  categoryIds?: string[];
  vendorIds?: string[];
  /** For budget_threshold: the percentage of the budget, e.g. 80. */
  budgetPercent?: number | null;
  /** For budget_threshold: which kind of year the budget is read for. */
  calendar?: "hijri" | "au" | "cy";
};

export type AlertRecipients = { teamIds?: string[]; userIds?: string[] };

export type AlertRule = {
  id: string;
  name: string;
  event: AlertEvent;
  conditions: AlertConditions;
  recipients: AlertRecipients;
  active: boolean;
};

export type AlertContext = {
  amount?: number;
  categoryIds?: string[];
  vendorId?: string | null;
  /** For budget_threshold: the category whose budget moved, and its use before and after, as fractions. */
  budget?: { categoryId: string; usedBefore: number; usedAfter: number; calendar?: "hijri" | "au" | "cy" };
};

/** Whether a rule fires for an event with these facts. */
export function ruleMatches(rule: AlertRule, event: AlertEvent, context: AlertContext): boolean {
  if (!rule.active || rule.event !== event) return false;
  const c = rule.conditions ?? {};

  if (c.minAmount != null && (context.amount ?? 0) < c.minAmount) return false;
  if (c.vendorIds?.length && (!context.vendorId || !c.vendorIds.includes(context.vendorId))) return false;

  if (event === "budget_threshold") {
    if (!context.budget || c.budgetPercent == null) return false;
    if (context.budget.calendar && (c.calendar ?? "hijri") !== context.budget.calendar) return false;
    if (c.categoryIds?.length && !c.categoryIds.includes(context.budget.categoryId)) return false;
    const line = c.budgetPercent / 100;
    // Crossing the line, not being past it: an alert that fired at 80% should
    // not fire again on every expense after.
    return context.budget.usedBefore < line && context.budget.usedAfter >= line;
  }

  if (c.categoryIds?.length && !(context.categoryIds ?? []).some((id) => c.categoryIds!.includes(id))) return false;
  return true;
}

/** Active users named by a rule, directly or through a team. */
export async function recipientsOf(admin: SupabaseClient, recipients: AlertRecipients): Promise<string[]> {
  const ids = new Set(recipients.userIds ?? []);
  if (recipients.teamIds?.length) {
    const { data } = await admin.from("team_members").select("user_id").in("team_id", recipients.teamIds);
    for (const m of data ?? []) ids.add(m.user_id as string);
  }
  if (ids.size === 0) return [];
  const { data: active } = await admin.from("profiles").select("id").in("id", [...ids]).eq("is_active", true);
  return (active ?? []).map((p) => p.id as string);
}

/**
 * Sends every matching rule's alert. Never throws — an alert is a courtesy
 * beside the thing that happened.
 *
 * `message` is what the notification says; `firedKey`, when given, makes a
 * rule fire at most once for that key (a budget crossing per period).
 */
export async function runAlertRules(
  admin: SupabaseClient,
  event: AlertEvent,
  context: AlertContext,
  message: { title: string; body: string; link: string | null; expenseId?: string | null },
  firedKey?: (rule: AlertRule) => string
): Promise<void> {
  try {
    const { data, error } = await admin
      .from("alert_rules")
      .select("id, name, event, conditions, recipients, active")
      .eq("event", event)
      .eq("active", true);
    if (error || !data?.length) return;

    const { notify } = await import("@/lib/notifications-inapp");
    for (const rule of data as AlertRule[]) {
      if (!ruleMatches(rule, event, context)) continue;
      if (firedKey) {
        const { error: dup } = await admin.from("alert_rule_firings").insert({ rule_id: rule.id, fired_key: firedKey(rule) });
        if (dup) continue;
      }
      const userIds = await recipientsOf(admin, rule.recipients);
      await notify(
        admin,
        userIds.map((userId) => ({
          userId,
          kind: "alert" as const,
          title: `${rule.name}: ${message.title}`,
          body: message.body,
          link: message.link,
          expenseId: message.expenseId ?? null,
        }))
      );
    }
  } catch (err) {
    console.error("[alert-rules] failed:", err);
  }
}
