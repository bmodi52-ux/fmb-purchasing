"use client";

import { useMemo, useState } from "react";
import { gregorianToHijri, formatHijri } from "@/lib/hijri/hijri.js";
import { formatDate } from "@/lib/format";
import {
  ReportFilters,
  SectionTabs,
  type FilterOption,
  type ReportQuery,
} from "./report-filters";
import {
  totals,
  percentChange,
  byMonth,
  byMonthBreakdown,
  byCategory,
  byVendor,
  byItem,
  byStatus,
  insights,
  type Slice,
  type Dimension,
  type Bucket,
} from "./aggregate";
import {
  HeroFigure,
  StatTile,
  ColumnChart,
  StackedColumnChart,
  BarChart,
  LineChart,
  StackedBar,
  formatMoney,
  formatCompact,
  type LineSeriesData,
} from "./charts";

export type PerUnitRow = {
  groupName: string;
  vendorName: string;
  receiptDate: string | null;
  normalizedQuantity: number;
  normalizedUnit: string;
  perUnit: number;
};

/** Palette slot per stage, fixed so colour follows the stage and not its rank. */
const STATUS_SLOT: Record<string, number> = {
  submitted: 0,
  approved: 1,
  paid: 2,
  declined: 3,
};

function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DateCell({ date, calendar }: { date: string | null; calendar: "gregorian" | "hijri" }) {
  if (!date) return <>—</>;
  if (calendar === "gregorian") return <>{formatDate(date)}</>;
  return <>{formatHijri(gregorianToHijri(new Date(date)))}</>;
}

function perUnitVendorSeries(rows: PerUnitRow[]): LineSeriesData[] {
  const byVendorName = new Map<string, PerUnitRow[]>();
  for (const r of rows) {
    if (!r.receiptDate) continue;
    byVendorName.set(r.vendorName, [...(byVendorName.get(r.vendorName) ?? []), r]);
  }
  return [...byVendorName.entries()].map(([name, vendorRows]) => ({
    name,
    points: [...vendorRows]
      .sort((a, b) => (a.receiptDate ?? "").localeCompare(b.receiptDate ?? ""))
      .map((r) => ({ x: r.receiptDate!, y: r.perUnit })),
  }));
}

export function ReportsView({
  query,
  fiscalYears,
  currentFy,
  months,
  vendors,
  categories,
  items,
  current,
  previous,
  periodLabel,
  previousLabel,
  perUnitRows,
  hasCategoryOrItemFilter,
}: {
  query: ReportQuery;
  fiscalYears: number[];
  currentFy: number;
  months: string[];
  vendors: FilterOption[];
  categories: FilterOption[];
  items: FilterOption[];
  current: Slice;
  previous: Slice | null;
  periodLabel: string;
  previousLabel: string;
  perUnitRows: PerUnitRow[];
  hasCategoryOrItemFilter: boolean;
}) {
  const [calendar, setCalendar] = useState<"gregorian" | "hijri">("gregorian");

  const now = useMemo(() => totals(current), [current]);
  const before = useMemo(() => (previous ? totals(previous) : null), [previous]);
  const monthly = useMemo(() => byMonth(current), [current]);
  const found = useMemo(
    () => insights(current, previous, periodLabel, previousLabel),
    [current, previous, periodLabel, previousLabel]
  );

  const spendDelta = before ? percentChange(now.spend, before.spend) : null;
  const countDelta = before ? percentChange(now.expenseCount, before.expenseCount) : null;

  const empty = now.expenseCount === 0;
  const isFiltered =
    !!query.month || !!query.vendor || query.categories.length > 0 || query.items.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Reports</h1>
        <p className="page-description mt-1">
          Fiscal year runs Shawwal → the following Ramadan on the Fatimi/Misri Hijri calendar.
        </p>
      </div>

      <SectionTabs query={query} active={query.section} />

      {/* One filter row, above every section — so whichever tab you are on,
          the numbers describe the same slice. */}
      <ReportFilters
        query={query}
        fiscalYears={fiscalYears}
        currentFy={currentFy}
        months={months}
        vendors={vendors}
        categories={categories}
        items={items}
      />

      {empty ? (
        <p className="rounded-xl border border-ink/10 bg-white/60 px-4 py-8 text-center text-sm text-ink/55">
          Nothing recorded for {periodLabel}
          {isFiltered && " with these filters"}.
        </p>
      ) : (
        <>
          {/* The headline rides above every section: whatever you are looking
              at, the total it belongs to stays in view. */}
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="flex flex-col justify-center rounded-xl border border-gold/30 bg-gold/[0.07] p-5">
              <HeroFigure
                label={`Total spend · ${periodLabel}`}
                value={formatMoney(now.spend)}
                caption={`${now.expenseCount} ${now.expenseCount === 1 ? "expense" : "expenses"}, ${now.lineCount} ${now.lineCount === 1 ? "line" : "lines"}`}
              />
              {spendDelta != null && previousLabel && (
                <p className="mt-2.5 text-sm text-ink/70">
                  <span aria-hidden="true">{spendDelta > 0 ? "↑" : spendDelta < 0 ? "↓" : "→"}</span>{" "}
                  {Math.abs(Math.round(spendDelta * 100))}%{" "}
                  <span className="text-ink/50">
                    {spendDelta > 0 ? "more than" : spendDelta < 0 ? "less than" : "vs"}{" "}
                    {previousLabel}
                    {before && ` (${formatMoney(before.spend)})`}
                  </span>
                </p>
              )}
              {isFiltered && (
                <p className="mt-2 text-xs text-ink/45">Filtered — not the whole period.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Expenses"
                value={String(now.expenseCount)}
                delta={countDelta}
                deltaLabel={previousLabel}
                trend={monthly.map((m) => m.count)}
                hint={previousLabel ? undefined : "No earlier period to compare"}
              />
              <StatTile
                label="Average expense"
                value={formatMoney(now.averageExpense)}
                trend={monthly.map((m) => m.spend)}
              />
              {hasCategoryOrItemFilter ? (
                <StatTile
                  label="Lines in this slice"
                  value={String(now.lineCount)}
                  hint="GST is recorded per expense, so it isn't shown for a partial receipt"
                />
              ) : (
                <StatTile label="GST" value={formatMoney(now.gst)} hint="Included in total spend" />
              )}
            </div>
          </section>

          {query.section === "overview" && (
            <OverviewSection current={current} monthly={monthly} found={found} />
          )}
          {query.section === "categories" && (
            <DimensionSection
              current={current}
              dimension="category"
              title="Categories"
              unit="lines"
              filterHint={
                query.categories.length > 0
                  ? "Showing only the categories you've selected above."
                  : undefined
              }
            />
          )}
          {query.section === "vendors" && (
            <DimensionSection
              current={current}
              dimension="vendor"
              title="Vendors"
              unit="expenses"
              filterHint={query.vendor ? "Showing only the vendor you've selected above." : undefined}
            />
          )}
          {query.section === "items" && (
            <DimensionSection
              current={current}
              dimension="item"
              title="Items"
              unit="lines"
              filterHint={
                query.items.length > 0 ? "Showing only the items you've selected above." : undefined
              }
            />
          )}
          {query.section === "unit-costs" && (
            <UnitCostsSection
              perUnitRows={perUnitRows}
              calendar={calendar}
              onCalendarChange={setCalendar}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OverviewSection({
  current,
  monthly,
  found,
}: {
  current: Slice;
  monthly: Bucket[];
  found: ReturnType<typeof insights>;
}) {
  const statusMix = useMemo(() => byStatus(current), [current]);

  return (
    <>
      {found.length > 0 && (
        <section className="rounded-xl border border-ink/10 bg-white/60 p-4">
          <h2 className="text-xs tracking-wide text-ink/45 uppercase">What stands out</h2>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {found.map((insight) => (
              <li key={insight.text} className="flex gap-2 text-sm text-ink/85">
                <span aria-hidden="true" className="text-ink/30">
                  {insight.tone === "up" ? "↑" : insight.tone === "down" ? "↓" : "•"}
                </span>
                {insight.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {monthly.length > 1 && (
        <Panel title="Spend over time" subtitle="By month, using the receipt date where there is one">
          <ColumnChart
            data={monthly.map((m) => ({
              key: m.key,
              label: m.label,
              value: m.spend,
              count: m.count,
            }))}
            valueFormat={formatMoney}
          />
          <MonthTable monthly={monthly} />
        </Panel>
      )}

      <Panel title="Where it sits" subtitle="Expenses by stage, excluding declined">
        <StackedBar
          data={statusMix.map((s) => ({
            label: s.label,
            value: s.spend,
            detail: formatCompact(s.spend),
            slot: STATUS_SLOT[s.key] ?? 0,
          }))}
        />
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Categories, Vendors and Items are the same three questions asked of a
 * different column: how does it rank, how did it move month to month, and
 * what are the exact figures. One component, three configurations — three
 * near-identical copies would drift.
 */
function DimensionSection({
  current,
  dimension,
  title,
  unit,
  filterHint,
}: {
  current: Slice;
  dimension: Dimension;
  title: string;
  unit: "lines" | "expenses";
  filterHint?: string;
}) {
  const ranked = useMemo(() => {
    if (dimension === "category") return byCategory(current);
    if (dimension === "vendor") return byVendor(current);
    return byItem(current);
  }, [current, dimension]);

  const breakdown = useMemo(() => byMonthBreakdown(current, dimension), [current, dimension]);
  const total = ranked.reduce((s, b) => s + b.spend, 0);

  return (
    <>
      {filterHint && (
        <p className="rounded-lg border border-gold/30 bg-gold/[0.06] px-3 py-2 text-xs text-ink/70">
          {filterHint}
        </p>
      )}

      <Panel
        title={`Spend by ${dimension}`}
        onExport={() =>
          downloadCsv(
            `spend-by-${dimension}.csv`,
            ranked.map((b) => ({ [dimension]: b.label, [unit]: b.count, total: b.spend }))
          )
        }
      >
        <BarChart
          data={ranked.map((b) => ({ label: b.label, value: b.spend, count: b.count }))}
          maxBars={12}
          valueFormat={formatCompact}
        />
      </Panel>

      {breakdown.months.length > 1 && (
        <Panel
          title={`${title} over time`}
          subtitle={`Each month split by ${dimension}${
            breakdown.foldedCount > 0 ? ` — the smallest ${breakdown.foldedCount} are grouped` : ""
          }`}
        >
          <StackedColumnChart months={breakdown.months} series={breakdown.series} />
        </Panel>
      )}

      <Panel title="The numbers" subtitle="The record — chart colours are only a guide">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                <th className="py-2 pr-4 font-medium">{title.replace(/s$/, "")}</th>
                <th className="py-2 pr-4 text-right font-medium capitalize">{unit}</th>
                <th className="py-2 pr-4 text-right font-medium">Total</th>
                <th className="py-2 pr-4 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((b) => (
                <tr key={b.key} className="border-b border-ink/5 last:border-0">
                  <td className="py-1.5 pr-4">{b.label}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-ink/60 tabular-nums">
                    {b.count}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono tabular-nums">
                    {formatMoney(b.spend)}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-ink/60 tabular-nums">
                    {total > 0 ? `${Math.round((b.spend / total) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-ink/15 font-medium">
                <td className="py-2 pr-4">Total</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {ranked.reduce((s, b) => s + b.count, 0)}
                </td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">{formatMoney(total)}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */

function UnitCostsSection({
  perUnitRows,
  calendar,
  onCalendarChange,
}: {
  perUnitRows: PerUnitRow[];
  calendar: "gregorian" | "hijri";
  onCalendarChange: (c: "gregorian" | "hijri") => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, PerUnitRow[]>();
    for (const row of perUnitRows) {
      groups.set(row.groupName, [...(groups.get(row.groupName) ?? []), row]);
    }
    return [...groups.entries()];
  }, [perUnitRows]);

  return (
    <Panel
      title="Per-unit cost trends"
      subtitle="What we actually pay per kilo, litre or each — compare vendors within an item"
      onExport={
        perUnitRows.length > 0
          ? () =>
              downloadCsv(
                "per-unit-cost-trends.csv",
                perUnitRows.map((r) => ({
                  item: r.groupName,
                  vendor: r.vendorName,
                  date: r.receiptDate ?? "",
                  quantity: r.normalizedQuantity,
                  unit: r.normalizedUnit,
                  per_unit_cost: r.perUnit,
                }))
              )
          : undefined
      }
      action={
        <div className="flex items-center gap-1 text-xs">
          <span className="text-ink/45">Dates:</span>
          {(["gregorian", "hijri"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onCalendarChange(c)}
              aria-pressed={calendar === c}
              className={`rounded px-1.5 py-0.5 ${
                calendar === c ? "bg-gold/20 text-ink" : "text-ink/50 hover:text-ink"
              }`}
            >
              {c === "gregorian" ? "Gregorian" : "Hijri"}
            </button>
          ))}
        </div>
      }
    >
      {grouped.length === 0 ? (
        <p className="text-sm text-ink/50">
          No per-unit data here yet. It appears once a receipt line is matched to a pricelist item
          with confirmed pack contents.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([groupName, rows]) => {
            const series = perUnitVendorSeries(rows);
            const datedPoints = series.reduce((n, s) => n + s.points.length, 0);
            return (
              <div key={groupName}>
                <h3 className="mb-2 text-sm font-medium text-ink">{groupName}</h3>
                {datedPoints >= 2 ? (
                  <LineChart series={series} valueFormat={(v) => `$${v.toFixed(4)}`} height={150} />
                ) : (
                  <p className="text-xs text-ink/50">
                    One purchase so far — a trend appears once there is something to compare it
                    against.
                  </p>
                )}
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink/45">
                        <th className="py-1 pr-3 font-medium">Vendor</th>
                        <th className="py-1 pr-3 font-medium">Date</th>
                        <th className="py-1 pr-3 text-right font-medium">Quantity</th>
                        <th className="py-1 text-right font-medium">Per unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-ink/5">
                          <td className="py-1 pr-3">{r.vendorName}</td>
                          <td className="py-1 pr-3 font-mono text-ink/60">
                            <DateCell date={r.receiptDate} calendar={calendar} />
                          </td>
                          <td className="py-1 pr-3 text-right font-mono text-ink/60 tabular-nums">
                            {r.normalizedQuantity} {r.normalizedUnit}
                          </td>
                          <td className="py-1 text-right font-mono tabular-nums">
                            ${r.perUnit.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/** Monthly figures in full, so they are never hover-only. */
function MonthTable({ monthly }: { monthly: Bucket[] }) {
  return (
    <div className="mt-4 overflow-x-auto border-t border-ink/5 pt-3">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
            <th className="py-2 pr-4 font-medium">Month</th>
            <th className="py-2 pr-4 text-right font-medium">Expenses</th>
            <th className="py-2 pr-4 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m) => (
            <tr key={m.key} className="border-b border-ink/5 last:border-0">
              <td className="py-1.5 pr-4">{m.label}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-ink/60 tabular-nums">
                {m.count}
              </td>
              <td className="py-1.5 pr-4 text-right font-mono tabular-nums">
                {formatMoney(m.spend)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  onExport,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  onExport?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink/10 bg-white/60 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="section-title text-ink capitalize">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink/50">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              className="text-xs text-ink/50 underline hover:text-ink"
            >
              CSV
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
