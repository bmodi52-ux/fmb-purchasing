"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { gregorianToHijri, formatHijri } from "@/lib/hijri/hijri.js";
import { formatDate } from "@/lib/format";
import {
  ReportFilters,
  SectionTabs,
  buildHref,
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
  compare,
  MAX_COMPARE_SUBJECTS,
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
  SmallMultiple,
  seriesHue,
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
  unitCostByItem,
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
  unitCostByItem: Record<string, { average: number; unit: string }>;
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
    !!query.month ||
    query.vendors.length > 0 ||
    query.categories.length > 0 ||
    query.items.length > 0;

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
          {query.section === "breakdown" && <BreakdownSection query={query} current={current} />}
          {query.section === "compare" && (
            <CompareSection
              query={query}
              current={current}
              vendors={vendors}
              categories={categories}
              items={items}
              unitCostByItem={unitCostByItem}
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

const BREAKDOWN_CONFIG: Record<
  Dimension,
  { title: string; unit: "lines" | "expenses"; pillLabel: string }
> = {
  category: { title: "Categories", unit: "lines", pillLabel: "Categories" },
  vendor: { title: "Vendors", unit: "expenses", pillLabel: "Vendors" },
  item: { title: "Items", unit: "lines", pillLabel: "Items" },
};

/**
 * Categories, Vendors and Items are the same question asked of a different
 * column: how does it rank, how did it move month to month, and what are the
 * exact figures. One dimension picker rather than three tabs — the same
 * pattern Compare already uses for choosing what to group by.
 */
function BreakdownSection({ query, current }: { query: ReportQuery; current: Slice }) {
  const dimension = query.breakdownBy;
  const config = BREAKDOWN_CONFIG[dimension];

  const selectedCount =
    dimension === "category"
      ? query.categories.length
      : dimension === "vendor"
        ? query.vendors.length
        : query.items.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ink/10 bg-white/60 p-3">
        <span className="text-xs text-ink/55">Break down by</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["category", BREAKDOWN_CONFIG.category.pillLabel],
              ["vendor", BREAKDOWN_CONFIG.vendor.pillLabel],
              ["item", BREAKDOWN_CONFIG.item.pillLabel],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={buildHref(query, { breakdownBy: value })}
              aria-current={dimension === value ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                dimension === value
                  ? "bg-gold/25 text-ink ring-1 ring-gold/50"
                  : "border border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <DimensionSection
        current={current}
        dimension={dimension}
        title={config.title}
        unit={config.unit}
        filterHint={
          selectedCount > 0
            ? `Showing only the ${config.title.toLowerCase()} you've selected above.`
            : undefined
        }
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

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

/**
 * The same chart once per subject, all on one scale.
 *
 * This is the answer to "let me filter each panel separately" that keeps the
 * numbers honest: every card names what it is, so none of them can be
 * mistaken for the period total, which stays above on its own.
 */
function CompareSection({
  query,
  current,
  vendors,
  categories,
  items,
  unitCostByItem,
}: {
  query: ReportQuery;
  current: Slice;
  vendors: FilterOption[];
  categories: FilterOption[];
  items: FilterOption[];
  unitCostByItem: Record<string, { average: number; unit: string }>;
}) {
  const dimension = query.compareBy;

  // Subjects come from the filter menus, so there is one place to pick
  // things rather than a parallel selector that could disagree with them.
  const chosen =
    dimension === "item" ? query.items : dimension === "category" ? query.categories : query.vendors;

  const comparison = useMemo(
    () => compare(current, dimension, chosen, MAX_COMPARE_SUBJECTS),
    [current, dimension, chosen]
  );

  const optionCount =
    dimension === "item" ? items.length : dimension === "category" ? categories.length : vendors.length;

  const usingDefaults = chosen.length === 0;
  const overCap = chosen.length > MAX_COMPARE_SUBJECTS;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ink/10 bg-white/60 p-3">
        <span className="text-xs text-ink/55">Compare by</span>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["item", "Items"],
              ["category", "Categories"],
              ["vendor", "Vendors"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={buildHref(query, { compareBy: value })}
              aria-current={dimension === value ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                dimension === value
                  ? "bg-gold/25 text-ink ring-1 ring-gold/50"
                  : "border border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-ink/45">
          {usingDefaults
            ? `Showing the top ${comparison.subjects.length} by spend — pick specific ${dimension}s in the filter bar to choose your own.`
            : `Comparing ${comparison.subjects.length} of ${optionCount}.`}
        </p>
      </div>

      {overCap && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-ink/75">
          {chosen.length} selected, showing the first {MAX_COMPARE_SUBJECTS}. Past that the cards get
          too narrow to read and the palette runs out of hues that stay distinct for colourblind
          readers.
        </p>
      )}

      {comparison.subjects.length === 0 ? (
        <p className="rounded-xl border border-ink/10 bg-white/60 px-4 py-8 text-center text-sm text-ink/55">
          Nothing to compare with the current filters.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink/50">
            One card each, one shared scale — heights are directly comparable. Axis tops out at{" "}
            {formatMoney(comparison.sharedMax)} a month.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {comparison.subjects.map((s, i) => {
              const unitCost = dimension === "item" ? unitCostByItem[s.key] : undefined;
              return (
                <div
                  key={s.key}
                  className="rounded-xl border border-ink/10 bg-white/60 p-3.5"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: seriesHue(i) }}
                    />
                    <p className="min-w-0 text-sm font-medium break-words text-ink">{s.label}</p>
                  </div>

                  <p className="mt-1.5 text-xl leading-none font-semibold text-ink">
                    {formatMoney(s.total)}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {s.occurrences} {occurrenceNoun(dimension, s.occurrences)}
                    {unitCost && ` · $${unitCost.average.toFixed(2)}/${unitCost.unit} avg`}
                  </p>

                  <div className="mt-3">
                    <SmallMultiple
                      months={comparison.months}
                      values={s.values}
                      sharedMax={comparison.sharedMax}
                      slot={i}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <Panel title="The numbers" subtitle="Side by side, in full">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                    <th className="py-2 pr-4 font-medium">Month</th>
                    {comparison.subjects.map((s) => (
                      <th key={s.key} className="py-2 pr-4 text-right font-medium">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.months.map((m, i) => (
                    <tr key={m.key} className="border-b border-ink/5 last:border-0">
                      <td className="py-1.5 pr-4">{m.label}</td>
                      {comparison.subjects.map((s) => (
                        <td
                          key={s.key}
                          className="py-1.5 pr-4 text-right font-mono tabular-nums"
                        >
                          {s.values[i] > 0 ? formatMoney(s.values[i]) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-ink/15 font-medium">
                    <td className="py-2 pr-4">Total</td>
                    {comparison.subjects.map((s) => (
                      <td key={s.key} className="py-2 pr-4 text-right font-mono tabular-nums">
                        {formatMoney(s.total)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

function occurrenceNoun(dimension: Dimension, n: number): string {
  if (dimension === "vendor") return n === 1 ? "expense" : "expenses";
  return n === 1 ? "purchase" : "purchases";
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
