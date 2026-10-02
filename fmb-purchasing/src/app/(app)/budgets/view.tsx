import type { CurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { categoryLabelsById } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { DownloadLinks } from "@/components/download-links";
import { ReportTableView } from "@/components/report-table";
import { ReportTile } from "@/components/report-tile";
import { SubmitButton } from "@/components/submit-button";
import { DATE_BASIS_LABEL } from "@/lib/reporting/basis";
import { budgetTables, loadBudgetView } from "@/lib/reporting/budget-view";
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

/** How many tiles across, by how many there are. */
const TILE_COLUMNS: Record<number, string> = {
  4: "xl:grid-cols-4",
  5: "lg:grid-cols-3 2xl:grid-cols-5",
  6: "lg:grid-cols-3 2xl:grid-cols-6",
};

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
  // The month-by-month table is the download's (budget-view budgetTables), so the page and the file are one table.
  const monthsTable = budgetTables(view).find((t) => t.title === "By month") ?? null;
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
          actions={<DownloadLinks href={`/reports/export?${exported}`} />}
        />
        <ReportFilterBar
          filters={findReport("budgets")!.filters}
          period={period.code}
          today={today}
          earliest={earliest}
          options={{ categories: view.categoryOptions }}
          selected={{ categories: view.categories }}
        />
      </div>

      {/* The same tiles as every report: four as a rule, and up to six when
          spend sits where no budget can hold it — laid out so that none is
          left alone on a row. */}
      <div className={`grid gap-3 sm:grid-cols-2 ${TILE_COLUMNS[4 + (onParentSpend !== 0 ? 1 : 0) + (uncategorisedSpend !== 0 ? 1 : 0)]}`}>
        <ReportTile
          label="Budgeted"
          value={totals.remaining !== null ? money(totals.budgeted) : "Not set"}
          tone={totals.remaining !== null ? "normal" : "muted"}
          hint={totals.remaining !== null ? period.label : `No budgets for ${period.label}`}
        />
        <ReportTile label={MEASURES.paid.label} value={money(totals.paid)} />
        <ReportTile label={MEASURES.committed.label} value={money(totals.committed)} />
        <ReportTile
          label="Remaining"
          value={totals.remaining !== null ? money(totals.remaining) : "—"}
          tone={totals.remaining === null ? "muted" : totals.remaining < 0 ? "danger" : "normal"}
          dot={totals.remaining !== null && totals.remaining < 0 ? "alert" : undefined}
          hint={totals.remaining !== null && rows.some((r) => r.budget === null && r.spent !== 0) ? "Of the categories with a budget" : undefined}
        />
        {onParentSpend !== 0 && <ReportTile label="On a parent category" value={money(onParentSpend)} tone="muted" hint="Under no budget" />}
        {uncategorisedSpend !== 0 && <ReportTile label="Not in any category" value={money(uncategorisedSpend)} tone="muted" hint="Under no budget" />}
      </div>

      {(onParentSpend !== 0 || uncategorisedSpend !== 0) && (
        <div className="-mt-3 flex max-w-3xl flex-col gap-1.5 text-support text-ink/70">
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
              <a href="/review-queue" className="text-brand underline underline-offset-[3px]">Needs attention</a>.
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

      {view.months.length > 1 && monthsTable && (
        <section className="card p-[1.1rem]">
          <h2 className="text-base font-semibold text-ink">By month</h2>
          <p className="mt-0.5 max-w-3xl text-support text-ink/70">
            The budgeted categories a month at a time. Each month&rsquo;s budget follows its phasing where one is set —
            Ramadan&rsquo;s share is not a twelfth of the year&rsquo;s — and is spread by day where not. A month over its
            budget, and a year so far over its budget so far, are marked.
          </p>
          <div className="mt-3.5">
            <ReportTableView table={monthsTable} />
          </div>
        </section>
      )}

      {(changeRows ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">Recent budget changes</h2>
          <ol className="flex flex-col divide-y divide-ink/[0.06] card text-body">
            {(changeRows ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 px-[1.1rem] py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
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
                <span className="shrink-0 text-support text-ink/70">
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
