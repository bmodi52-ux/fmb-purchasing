import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { budgetsForPeriod, loadBudgets } from "@/lib/budgets";
import { PeriodPicker } from "@/components/period-picker";
import { SubmitButton } from "@/components/submit-button";
import { loadReportRawData, withinRange } from "../reports/data";
import { copyBudgetsFromPrevious } from "./actions";
import { BudgetInput } from "./budget-input";

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

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "budgets", "edit_master_data");

  const params = await searchParams;
  const today = todayIso();
  const period = parsePeriod(params.period ?? params.fy, today);
  const previous = previousPeriod(period, today);

  const admin = createAdminClient();
  const [{ data: categoryRows }, budgets, report, earliest, { data: changeRows }] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
    loadBudgets(admin),
    loadReportRawData(period).then((raw) => withinRange(raw, period)),
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
  // and withdrawn expenses are already excluded upstream.
  const spentByCategory = new Map<string, number>();
  for (const line of report.allLines) {
    if (!line.categoryId) continue;
    spentByCategory.set(line.categoryId, (spentByCategory.get(line.categoryId) ?? 0) + line.lineTotal);
  }

  const rows = categories
    .map((c) => {
      const share = perCategory.get(c.id);
      const budget = share && share.uncoveredDays < share.days ? share.amount : null;
      const spent = spentByCategory.get(c.id) ?? 0;
      return {
        id: c.id,
        label: labels.get(c.id) ?? c.name,
        budget,
        share,
        spent,
        // Null when nothing is budgeted: a category with no budget is not
        // "100% over", it is undecided, and reporting it as a breach would
        // train people to ignore the column.
        usedPct: budget && budget > 0 ? spent / budget : null,
      };
    })
    .sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || b.spent - a.spent);

  const totalBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const anyExactForPeriod = rows.some((r) => r.share?.exact);
  const canCopy = canEdit && !anyExactForPeriod && budgets.some((b) => b.start === previous.start && b.end === previous.end);

  /**
   * Spend that belongs to no category, and so appears in no budget.
   *
   * Card surcharges, delivery and rounding carry no category by design — a
   * surcharge is not a kind of food — and a line the reader could not classify
   * carries none either. Both are real money, so leaving them out silently
   * would make this page disagree with Reports by an amount nobody could
   * account for. Stated instead.
   */
  const categorisedIds = new Set(categories.map((c) => c.id));
  const uncategorisedSpend =
    Math.round(
      report.allLines
        .filter((l) => !l.categoryId || !categorisedIds.has(l.categoryId))
        .reduce((s, l) => s + l.lineTotal, 0) * 100
    ) / 100;

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
            What was set aside for {period.label}, against what has been spent. Set a budget for any period — it
            carries into every other: a financial year shows the part of each Hijri year&rsquo;s budget that
            falls inside it. Amounts include GST, the same as the totals on every receipt.
          </p>
        </div>
        <PeriodPicker value={period.code} today={today} earliest={earliest} />
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-ink/10 bg-white/60 px-5 py-4">
        <Figure label="Budgeted" value={totalBudget > 0 ? money(totalBudget) : "Not set"} />
        <Figure label="Spent" value={money(totalSpent)} />
        <Figure
          label="Remaining"
          value={totalBudget > 0 ? money(totalBudget - totalSpent) : "—"}
          tone={totalBudget > 0 && totalSpent > totalBudget ? "over" : "normal"}
        />
        {uncategorisedSpend !== 0 && (
          <div>
            <p className="text-xs text-ink/55">Not in any category</p>
            <p className="mt-0.5 text-xl font-semibold tabular-figures text-ink/60">
              {money(uncategorisedSpend)}
            </p>
          </div>
        )}
      </div>

      {uncategorisedSpend !== 0 && (
        <p className="-mt-3 max-w-2xl text-xs leading-relaxed text-ink/55">
          {money(uncategorisedSpend)} of this period&rsquo;s spend sits in no category — surcharges,
          delivery and rounding carry none by design, and neither does a line nobody has
          classified yet. It is real money and counts in Reports; it simply cannot be budgeted
          against. Anything classifiable is listed on{" "}
          <a href="/review-queue" className="underline">Needs attention</a>.
        </p>
      )}

      {canCopy && (
        <form action={copyBudgetsFromPrevious}>
          <input type="hidden" name="period" value={period.code} />
          <SubmitButton className="rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30">
            Start from {previous.label}&rsquo;s budgets
          </SubmitButton>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Budget against actual spend by category for {period.label}</caption>
          <thead className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs text-ink/55">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Budget</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Spent</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Remaining</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const over = row.usedPct !== null && row.usedPct > 1;
              const share = row.share;
              const derived = row.budget !== null && !share?.exact;
              return (
                <tr key={row.id} className="border-b border-ink/5 align-top last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit ? (
                      <BudgetInput
                        categoryId={row.id}
                        categoryLabel={row.label}
                        period={period.code}
                        defaultValue={share?.exact ? share.exact.amount : null}
                        placeholder={derived ? money(row.budget!) : "—"}
                      />
                    ) : (
                      <span className="font-mono text-ink/70">{row.budget === null ? "—" : money(row.budget)}</span>
                    )}
                    <BudgetNote share={share} exact={!!share?.exact} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-figures text-ink/80">{money(row.spent)}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-figures ${over ? "text-maroon" : "text-ink/80"}`}
                  >
                    {row.budget === null ? "—" : money(row.budget - row.spent)}
                  </td>
                  <td className="px-4 py-2.5">
                    <UsageBar pct={row.usedPct} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(changeRows ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">Recent budget changes</h2>
          <ol className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(changeRows ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-ink">
                  {labels.get(c.category_id as string) ?? "A removed category"} · {c.label}:{" "}
                  {CHANGE_WORDS[c.kind as string] ?? c.kind}
                  {c.kind === "moved_by_override" && c.caused_by_label ? ` ${c.caused_by_label}` : ""}
                  {c.kind === "set" && c.caused_by_label ? ` (${c.caused_by_label})` : ""}
                  {" — "}
                  <span className="font-mono">
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

/** Where a period's budget comes from, when it is not simply the budget set for it. */
function BudgetNote({
  share,
  exact,
}: {
  share: { days: number; uncoveredDays: number; sources: { label: string }[] } | undefined;
  exact: boolean;
}) {
  if (!share || share.uncoveredDays === share.days) return null;
  const parts: string[] = [];
  const others = share.sources.filter((s, i) => !exact || i > 0);
  if (!exact && others.length > 0) parts.push(`from ${others.map((s) => s.label).join(" and ")}`);
  if (share.uncoveredDays > 0) {
    parts.push(`${share.uncoveredDays} of ${share.days} days have no budget set`);
  }
  if (parts.length === 0) return null;
  return <p className={`mt-1 text-xs ${share.uncoveredDays > 0 ? "text-maroon/80" : "text-ink/45"}`}>{parts.join(" · ")}</p>;
}

function Figure({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "over";
}) {
  return (
    <div>
      <p className="text-xs text-ink/55">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-figures ${tone === "over" ? "text-maroon" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Proportion of a budget used.
 *
 * No red until it is actually over. Spending 90% of a budget nine months into
 * the year is exactly what a budget is for, and colouring it as a warning
 * teaches people that the colour means nothing.
 */
function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-ink/35">no budget set</span>;

  const over = pct > 1;
  const width = Math.min(100, Math.round(pct * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
        <div className={`h-full rounded-full ${over ? "bg-maroon" : "bg-gold-deep"}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`font-mono text-xs ${over ? "text-maroon" : "text-ink/55"}`}>{Math.round(pct * 100)}%</span>
    </div>
  );
}
