"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { planBudgetSave, NEW_BUDGET_ID } from "@/lib/budget-allocation";
import { loadBudgets, type StoredBudget } from "@/lib/budgets";
import { reportError } from "@/lib/errors";

export type BudgetSaveState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string }
  | {
      status: "conflict";
      /** What overriding would change, in words the warning shows. */
      changes: { label: string; from: number; to: number }[];
      amount: string;
    };

type Write = {
  id?: string;
  category_id: string;
  start_date: string;
  end_date: string;
  period_code: string;
  label: string;
  amount: number;
  priority: number;
};

async function write(actorId: string, budgets: Write[], changes: object[]): Promise<string | null> {
  const { error } = await createAdminClient().rpc("save_category_budgets", {
    p_actor: actorId,
    p_budgets: budgets,
    p_changes: changes,
  });
  if (error) {
    await reportError({ source: "budgets", error: error.message, userId: actorId });
    return "The budget could not be saved, and nothing was changed. Try again.";
  }
  return null;
}

/**
 * Sets, changes or clears one category's budget for the period on screen.
 *
 * Budgets for any period carry across into every other (#22, and the rule in
 * lib/budget-allocation.ts). When the totals cannot all hold, nothing is saved
 * and the person is shown what an override would change; sending the form
 * again with `override` applies it, and records every budget it moved.
 *
 * A blank amount clears a budget set for exactly this period. It does not
 * store zero: no budget means "we have not decided", zero means "we have
 * decided to spend nothing here".
 */
export async function saveBudget(_prev: BudgetSaveState, formData: FormData): Promise<BudgetSaveState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "edit_master_data");

  const categoryId = String(formData.get("category_id") ?? "");
  const raw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  const override = formData.get("override") === "1";
  if (!categoryId) return { status: "error", message: "No category to save against." };

  const period = parsePeriod(String(formData.get("period") ?? ""), todayIso());
  const admin = createAdminClient();
  const existing = await loadBudgets(admin, [categoryId]);
  const exact = existing.find((b) => b.start === period.start && b.end === period.end) ?? null;

  if (raw === "") {
    if (!exact) return { status: "saved" };
    const { error } = await admin.rpc("clear_category_budget", { p_actor: user.id, p_budget_id: exact.id });
    if (error) {
      await reportError({ source: "budgets", error: error.message, userId: user.id });
      return { status: "error", message: "The budget could not be cleared. Try again." };
    }
    revalidatePath("/budgets");
    return { status: "saved" };
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    return { status: "error", message: "Enter the budget as an amount in dollars, such as 12000." };
  }

  const plan = planBudgetSave(existing, {
    id: exact?.id,
    start: period.start,
    end: period.end,
    amount,
    label: period.label,
  });

  if (plan.conflicts && !override) {
    return {
      status: "conflict",
      changes: plan.override.changes.map((c) => ({ label: c.label, from: c.from, to: c.to })),
      amount: raw,
    };
  }

  const chosen = plan.conflicts ? plan.override : plan.plain;
  const byId = new Map(existing.map((b) => [b.id, b]));
  const changedIds = new Set(chosen.changes.map((c) => c.budgetId));

  const writes: Write[] = chosen.budgets
    .filter((b) => b.id === chosen.candidateId || changedIds.has(b.id) || byId.get(b.id)?.priority !== b.priority)
    .map((b) => {
      const stored = byId.get(b.id) as StoredBudget | undefined;
      return {
        id: b.id === NEW_BUDGET_ID ? undefined : b.id,
        category_id: categoryId,
        start_date: b.start,
        end_date: b.end,
        period_code: b.id === chosen.candidateId ? period.code : (stored?.periodCode ?? period.code),
        label: b.label,
        amount: b.amount,
        priority: b.priority,
      };
    });

  const history = [
    {
      category_id: categoryId,
      label: period.label,
      start_date: period.start,
      end_date: period.end,
      kind: exact ? "changed" : "set",
      from_amount: exact?.amount ?? null,
      to_amount: amount,
    },
    ...chosen.changes.map((c) => {
      const moved = byId.get(c.budgetId)!;
      return {
        category_id: categoryId,
        label: moved.label,
        start_date: moved.start,
        end_date: moved.end,
        kind: "moved_by_override",
        from_amount: c.from,
        to_amount: c.to,
        caused_by_label: period.label,
      };
    }),
  ];

  const failed = await write(user.id, writes, history);
  if (failed) return { status: "error", message: failed };

  revalidatePath("/budgets");
  return { status: "saved" };
}

/**
 * Copies the previous period's budgets forward as a starting point.
 *
 * Setting eighteen categories from scratch every year is the kind of chore
 * that means budgets get set once and never again. Only budgets set for
 * exactly the previous period are copied, only into categories with nothing
 * set for exactly this one, and never where the copy would conflict with a
 * budget already covering these days — so this is safe to run twice and
 * cannot move a figure someone has already thought about.
 */
export async function copyBudgetsFromPrevious(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "edit_master_data");

  const today = todayIso();
  const period = parsePeriod(String(formData.get("period") ?? ""), today);
  const previous = previousPeriod(period, today);

  const admin = createAdminClient();
  const all = await loadBudgets(admin);

  const writes: Write[] = [];
  const history: object[] = [];
  const categoryIds = [...new Set(all.map((b) => b.categoryId))];
  for (const categoryId of categoryIds) {
    const mine = all.filter((b) => b.categoryId === categoryId);
    const source = mine.find((b) => b.start === previous.start && b.end === previous.end);
    if (!source || mine.some((b) => b.start === period.start && b.end === period.end)) continue;

    const plan = planBudgetSave(mine, { start: period.start, end: period.end, amount: source.amount, label: period.label });
    if (plan.conflicts) continue;
    const candidate = plan.plain.budgets.find((b) => b.id === NEW_BUDGET_ID)!;
    writes.push({
      category_id: categoryId,
      start_date: period.start,
      end_date: period.end,
      period_code: period.code,
      label: period.label,
      amount: source.amount,
      priority: candidate.priority,
    });
    history.push({
      category_id: categoryId,
      label: period.label,
      start_date: period.start,
      end_date: period.end,
      kind: "set",
      from_amount: null,
      to_amount: source.amount,
      caused_by_label: `Copied from ${previous.label}`,
    });
  }

  if (writes.length === 0) return;
  const failed = await write(user.id, writes, history);
  if (failed) throw new Error(failed);
  revalidatePath("/budgets");
}
