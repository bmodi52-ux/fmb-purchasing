"use client";

import { canPhase, type CategoryPeriodBudget } from "@/lib/budgets";
import { monthOf, type CalendarKind } from "@/lib/periods";
import { ColumnFilterBar, useColumnFilters, type FilterColumn } from "@/components/column-filter-bar";
import { BudgetInput } from "./budget-input";
import { BudgetPhasing } from "./budget-phasing";

/**
 * Budget against spend, by category, filterable a column at a time (#68).
 *
 * The table is drawn here rather than by the generic one because every row
 * carries a budget field, a note about where its figure came from and, on an
 * exact budget, a month-by-month phasing control — none of which a generic
 * table renders. So it takes the shared filter bar instead, which is the same
 * menus the other lists use.
 *
 * Filtering is worth having here despite the short list: "which categories
 * are over" and "which have no budget set" are the two questions the page
 * exists to answer, and both are a tick away once the columns can be filtered.
 */

export type BudgetRow = {
  id: string;
  label: string;
  budget: number | null;
  share: CategoryPeriodBudget | undefined;
  spent: number;
  paid: number;
  committed: number;
  usedPct: number | null;
};

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** What each column holds, for the filters. Money as numbers, so a range works. */
const COLUMNS: FilterColumn<BudgetRow>[] = [
    { key: "label", label: "Category", value: (r) => r.label },
    { key: "budget", label: "Budget", value: (r) => r.budget },
    { key: "paid", label: "Paid", value: (r) => r.paid },
    { key: "committed", label: "Committed", value: (r) => r.committed },
    { key: "remaining", label: "Remaining", value: (r) => (r.budget === null ? null : r.budget - r.spent) },
  {
    key: "used",
    label: "Used",
    // Ticking "over budget" is the question; a percentage to four decimal
    // places is not something anybody picks from a list.
    value: (r) => (r.usedPct === null ? "no budget set" : r.usedPct > 1 ? "over budget" : "within budget"),
  },
];

export function BudgetsTable({
  rows,
  canEdit,
  period,
}: {
  rows: BudgetRow[];
  canEdit: boolean;
  period: { code: string; label: string; calendar: CalendarKind | null; year: number | null };
}) {
  const { filters, setFilters, filtered, text, active } = useColumnFilters(rows, COLUMNS);

  return (
    <div className="flex flex-col gap-2">
      <ColumnFilterBar rows={rows} columns={COLUMNS} filters={filters} setFilters={setFilters} text={text} />
      {active > 0 && (
        <p className="text-xs text-ink/45">
          {filtered.length} of {rows.length} categories.
        </p>
      )}
  <div className="overflow-x-auto rounded-lg border border-ink/10">
    <table className="min-w-full text-sm">
      <caption className="sr-only">Budget against actual spend by category for {period.label}</caption>
      <thead className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs text-ink/55">
        <tr>
          <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
          <th scope="col" className="px-4 py-2.5 text-right font-medium">Budget</th>
          <th scope="col" className="px-4 py-2.5 text-right font-medium">Paid</th>
          <th scope="col" className="px-4 py-2.5 text-right font-medium" title="Approved or waiting for approval, not yet paid">
            Committed
          </th>
          <th scope="col" className="px-4 py-2.5 text-right font-medium">Remaining</th>
          <th scope="col" className="px-4 py-2.5 font-medium">Used</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((row) => {
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
                {canEdit && share?.exact && canPhase(share.exact.periodCode) && period.calendar && period.year !== null && (
                  <BudgetPhasing
                    budgetId={share.exact.id}
                    months={Array.from({ length: 12 }, (_, i) => monthOf(period.calendar!, period.year!, i + 1).label)}
                    percents={share.exact.months ? share.exact.months.map((m) => m.percent) : null}
                  />
                )}
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-figures text-ink/80">{money(row.paid)}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-figures text-ink/60">{money(row.committed)}</td>
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
    </div>
  );
}

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
