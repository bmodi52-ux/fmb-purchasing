import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { budgetsForPeriod, loadBudgets } from "@/lib/budgets";
import { budgetActuals, budgetTotals } from "@/lib/budget-actuals";
import { PeriodPicker } from "@/components/period-picker";
import { SubmitButton } from "@/components/submit-button";
import { loadLedger } from "@/lib/reporting/ledger";
import { copyBudgetsFromPrevious } from "./actions";
import { BudgetsTable } from "./budgets-table";

export const metadata = { title: "Budgets" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const CHANGE_WORDS: Record<string, string> = {
  set: "Set",
  changed: "Changed",
  cleared: "Cleared",
  moved_by_override: "Moved by an override of",
};

/**
 * Budget against actual, per category, for any period (#22).
 *
 * A budget can be set for a Hijri year, a financial year, a calendar year, a
 * quarter, a month or any range, and every period shows what the budgets
 * already set put inside it — so a financial year shows the share of each
 * Hijri year's budget that falls within it. How overlapping budgets share
 * their days is in lib/budget-allocation.ts.
 *
 * Actuals come from the same cached ledger the Reports page reads, so a figure
 * here and a figure there can never disagree.
 */
export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; fy?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "view");

  const permissions = await getUserPermissions(user);
  const canEdit = can(permissions, "budgets", "edit_master_data");

  const params = await searchParams;
  const today = todayIso();
  const period = parsePeriod(params.period ?? params.fy, today);
  const previous = previousPeriod(period, today);

  const admin = createAdminClient();
  const [{ data: categoryRows }, budgets, report, earliest, { data: changeRows }] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
    loadBudgets(admin),
    loadLedger(period),
    earliestExpenseDate(admin),
    admin
      .from("category_budget_changes")
      .select("id, category_id, label, kind, from_amount, to_amount, caused_by_label, changed_by, changed_at")
      .order("changed_at", { ascending: false })
      .limit(30),
  ]);

  const categories = leafCategories(sortCategories(categoryRows ?? []));
  const labels = categoryLabelsById(categoryRows ?? []);
  const perCategory = budgetsForPeriod(budgets, period.start, period.end);

  // Actual spend, from the same line-level ledger Reports aggregates. Declined
  // and withdrawn expenses are already excluded upstream. Split into paid, and
  // committed — approved or still waiting — because a budget is used up as
  // soon as the money is promised, not when the transfer happens (#39).
  const actuals = budgetActuals(
    report.lines,
    new Map(report.expenses.map((e) => [e.id, e.status])),
    categoryRows ?? []
  );

  const rows = categories
    .map((c) => {
      const share = perCategory.get(c.id);
      const budget = share && share.uncoveredDays < share.days ? share.amount : null;
      const { spent, paid } = actuals.byLeaf.get(c.id) ?? { spent: 0, paid: 0 };
      return {
        id: c.id,
        label: labels.get(c.id) ?? c.name,
        budget,
        share,
        spent,
        paid,
        committed: spent - paid,
        // Null when nothing is budgeted: a category with no budget is not
        // "100% over", it is undecided, and reporting it as a breach would
        // train people to ignore the column.
        usedPct: budget && budget > 0 ? spent / budget : null,
      };
    })
    .sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || b.spent - a.spent);

  const totals = budgetTotals(rows);
  const anyExactForPeriod = rows.some((r) => r.share?.exact);
  const canCopy = canEdit && !anyExactForPeriod && budgets.some((b) => b.start === previous.start && b.end === previous.end);

  /**
   * Spend no budget row holds, stated rather than left out, so this page never
   * disagrees with Reports by an amount nobody can account for.
   *
   * Uncategorised: card surcharges, delivery and rounding carry no category by
   * design — a surcharge is not a kind of food — and a line nobody has
   * classified carries none either. On a parent category: filed against
   * "Meat & Poultry" itself rather than one of its subcategories, which is
   * where budgets are set. That is categorised spend, and used to be called
   * "not in any category" here while Reports showed it under Meat.
   */
  const uncategorisedSpend = actuals.uncategorised;
  const onParentCategories = actuals.onParentCategories.map((p) => ({
    ...p,
    label: labels.get(p.categoryId) ?? "A category",
  }));
  const onParentSpend = onParentCategories.reduce((s, p) => s + p.amount, 0);

  const changers = [...new Set((changeRows ?? []).map((r) => r.changed_by).filter(Boolean) as string[])];
  const { data: people } = changers.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", changers)
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="page-title text-ink">Budgets</h1>
          <p className="page-description mt-1 max-w-2xl">
            What was set aside for {period.label}, against what has been spent. Amounts include GST.
          </p>
        </div>
        <PeriodPicker value={period.code} today={today} earliest={earliest} />
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 card px-5 py-4">
        <Figure label="Budgeted" value={totals.remaining !== null ? money(totals.budgeted) : "Not set"} />
        <Figure label="Paid" value={money(totals.paid)} />
        <Figure label="Committed" value={money(totals.committed)} />
        <Figure
          label="Remaining"
          value={totals.remaining !== null ? money(totals.remaining) : "—"}
          tone={totals.remaining !== null && totals.remaining < 0 ? "over" : "normal"}
          hint={totals.remaining !== null && rows.some((r) => r.budget === null && r.spent !== 0) ? "Of the categories with a budget" : undefined}
        />
        {onParentSpend !== 0 && <Figure label="On a parent category" value={money(onParentSpend)} tone="muted" />}
        {uncategorisedSpend !== 0 && <Figure label="Not in any category" value={money(uncategorisedSpend)} tone="muted" />}
      </div>

      {(onParentSpend !== 0 || uncategorisedSpend !== 0) && (
        <div className="-mt-3 flex max-w-2xl flex-col gap-1.5 text-xs leading-relaxed text-ink/55">
          {onParentSpend !== 0 && (
            <p>
              {money(onParentSpend)} was filed against{" "}
              {onParentCategories.map((p, i) => (
                <span key={p.categoryId}>
                  {i > 0 && (i === onParentCategories.length - 1 ? " and " : ", ")}
                  {p.label} ({money(p.amount)})
                </span>
              ))}{" "}
              itself rather than one of its subcategories, which is where budgets are set. It shows
              under that category in Reports; giving those lines a subcategory counts them against
              its budget.
            </p>
          )}
          {uncategorisedSpend !== 0 && (
            <p>
              {money(uncategorisedSpend)} of this period&rsquo;s spend sits in no category — surcharges,
              delivery and rounding carry none by design, and neither does a line nobody has
              classified yet. It is real money and counts in Reports; it simply cannot be budgeted
              against. Anything classifiable is listed on{" "}
              <a href="/review-queue" className="underline">Needs attention</a>.
            </p>
          )}
        </div>
      )}

      {canCopy && (
        <form action={copyBudgetsFromPrevious}>
          <input type="hidden" name="period" value={period.code} />
          <SubmitButton className="btn btn-secondary">
            Start from {previous.label}&rsquo;s budgets
          </SubmitButton>
        </form>
      )}

      <BudgetsTable rows={rows} canEdit={canEdit} period={period} />

      {(changeRows ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">Recent budget changes</h2>
          <ol className="flex flex-col divide-y divide-ink/5 card text-sm">
            {(changeRows ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-ink">
                  {labels.get(c.category_id as string) ?? "A removed category"} · {c.label}:{" "}
                  {CHANGE_WORDS[c.kind as string] ?? c.kind}
                  {c.kind === "moved_by_override" && c.caused_by_label ? ` ${c.caused_by_label}` : ""}
                  {c.kind === "set" && c.caused_by_label ? ` (${c.caused_by_label})` : ""}
                  {" — "}
                  <span className="tabular-nums">
                    {c.from_amount != null ? money(Number(c.from_amount)) : "none"} →{" "}
                    {c.to_amount != null ? money(Number(c.to_amount)) : "none"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink/50">
                  {c.changed_by ? (nameById.get(c.changed_by as string) ?? "A removed account") : "—"} ·{" "}
                  {formatDateTime(c.changed_at as string)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** One figure in the totals strip. Muted for spend no budget row holds. */
function Figure({
  label,
  value,
  tone = "normal",
  hint,
}: {
  label: string;
  value: string;
  tone?: "normal" | "over" | "muted";
  hint?: string;
}) {
  const colour = tone === "over" ? "text-danger" : tone === "muted" ? "text-ink/60" : "text-ink";
  return (
    <div>
      <p className="text-xs text-ink/55">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-figures ${colour}`}>{value}</p>
      {hint && <p className="text-xs text-ink/45">{hint}</p>}
    </div>
  );
}
