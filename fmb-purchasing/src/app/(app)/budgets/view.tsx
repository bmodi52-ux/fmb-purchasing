import type { CurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { categoryLabelsById } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { DownloadLinks } from "@/components/download-links";
import { SubmitButton } from "@/components/submit-button";
import { DATE_BASIS_LABEL } from "@/lib/reporting/basis";
import { loadBudgetView } from "@/lib/reporting/budget-view";
import { standardFilters } from "@/lib/reporting/filters";
import { MEASURES } from "@/lib/reporting/measures";
import { findReport } from "@/lib/reporting/registry";
import { ReportFilterBar } from "../reports/report-filter-bar";
import { ReportHeader } from "../reports/report-header";
import { copyBudgetsFromPrevious } from "./actions";
import { BudgetsTable } from "./budgets-table";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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
export async function BudgetsReport({ user, params }: { user: CurrentUser; params: Params }) {
  const permissions = await getUserPermissions(user);
  const canEdit = can(permissions, "budgets", "edit_master_data");

  const today = todayIso();
  const period = parsePeriod(one(params.period) ?? one(params.fy), today);
  const previous = previousPeriod(period, today);

  const admin = createAdminClient();
  const [view, earliest, { data: categoryRows }, { data: changeRows }] = await Promise.all([
    // Shared with this page's download (reports/export), so the file is the page.
    loadBudgetView(admin, period, standardFilters(params).categories),
    earliestExpenseDate(admin),
    admin.from("categories").select("id, name, parent_category_id"),
    admin
      .from("category_budget_changes")
      .select("id, category_id, label, kind, from_amount, to_amount, caused_by_label, changed_by, changed_at")
      .order("changed_at", { ascending: false })
      .limit(30),
  ]);

  const labels = categoryLabelsById(categoryRows ?? []);
  const { rows, totals, budgets, onParentCategories } = view;
  const narrowed = view.categories.length > 0;
  const exported = new URLSearchParams({ report: "budgets", period: period.code });
  for (const c of view.categories) exported.append("category", c);
  const anyExactForPeriod = rows.some((r) => r.share?.exact);
  const canCopy = canEdit && !narrowed && !anyExactForPeriod && budgets.some((b) => b.start === previous.start && b.end === previous.end);

  const uncategorisedSpend = view.uncategorised;
  const onParentSpend = onParentCategories.reduce((s, p) => s + p.amount, 0);

  const changers = [...new Set((changeRows ?? []).map((r) => r.changed_by).filter(Boolean) as string[])];
  const { data: people } = changers.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", changers)
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <ReportHeader
          report="budgets"
          user={user}
          basis={`${DATE_BASIS_LABEL.receipt} · submitted, approved and paid`}
        />
        <ReportFilterBar
          filters={findReport("budgets")!.filters}
          period={period.code}
          today={today}
          earliest={earliest}
          options={{ categories: view.categoryOptions }}
          selected={{ categories: view.categories }}
        >
          <div className="ml-auto pb-1">
            <DownloadLinks href={`/reports/export?${exported}`} />
          </div>
        </ReportFilterBar>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 card px-5 py-4">
        <Figure label="Budgeted" value={totals.remaining !== null ? money(totals.budgeted) : "Not set"} />
        <Figure label={MEASURES.paid.label} value={money(totals.paid)} />
        <Figure label={MEASURES.committed.label} value={money(totals.committed)} />
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

      {view.months.length > 1 && (
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="section-title text-ink">By month</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-ink/60">
              The budgeted categories a month at a time. Each month&rsquo;s budget follows its phasing where
              one is set — Ramadan&rsquo;s share is not a twelfth of the year&rsquo;s — and is spread by day
              where not.
            </p>
          </div>
          <div className="overflow-x-auto card">
            <table className="min-w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-xs text-ink/55">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Month</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Budget</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Spent</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Left over</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Budget to date</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Spent to date</th>
                </tr>
              </thead>
              <tbody>
                {view.months.map((m) => {
                  const over = m.spent > m.budget;
                  const overToDate = m.cumulativeSpent > m.cumulativeBudget;
                  return (
                    <tr key={m.key} className="border-b border-ink/5 last:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-normal">{m.label}</th>
                      <td className="px-4 py-2 text-right tabular-nums">{money(m.budget)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(m.spent)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${over ? "text-danger" : "text-ink/60"}`}>
                        {money(m.budget - m.spent)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink/60">{money(m.cumulativeBudget)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${overToDate ? "text-danger" : "text-ink/60"}`}>
                        {money(m.cumulativeSpent)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
