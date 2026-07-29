"use client";

import { useMemo, useState } from "react";
import { gregorianToHijri, formatHijri } from "@/lib/hijri/hijri.js";
import { formatDate } from "@/lib/format";
import { ReportFilters, type FilterOption } from "./report-filters";
import {
  totals,
  percentChange,
  byMonth,
  byCategory,
  byVendor,
  byItem,
  byStatus,
  insights,
  type Slice,
} from "./aggregate";
import {
  HeroFigure,
  StatTile,
  ColumnChart,
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

/** One line per vendor within an item group, dated points only. */
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
  fiscalYears,
  currentFy,
  selectedFy,
  months,
  selectedMonth,
  vendors,
  selectedVendor,
  categories,
  selectedCategory,
  items,
  selectedItem,
  current,
  previous,
  periodLabel,
  previousLabel,
  perUnitRows,
  hasCategoryOrItemFilter,
}: {
  fiscalYears: number[];
  currentFy: number;
  selectedFy: number;
  months: string[];
  selectedMonth: string;
  vendors: FilterOption[];
  selectedVendor: string;
  categories: FilterOption[];
  selectedCategory: string;
  items: FilterOption[];
  selectedItem: string;
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
  const categorySpend = useMemo(() => byCategory(current), [current]);
  const vendorSpend = useMemo(() => byVendor(current), [current]);
  const itemSpend = useMemo(() => byItem(current), [current]);
  const statusMix = useMemo(() => byStatus(current), [current]);
  const found = useMemo(
    () => insights(current, previous, periodLabel, previousLabel),
    [current, previous, periodLabel, previousLabel]
  );

  const spendDelta = before ? percentChange(now.spend, before.spend) : null;
  const countDelta = before ? percentChange(now.expenseCount, before.expenseCount) : null;

  const groupedPerUnit = useMemo(() => {
    const groups = new Map<string, PerUnitRow[]>();
    for (const row of perUnitRows) {
      groups.set(row.groupName, [...(groups.get(row.groupName) ?? []), row]);
    }
    return [...groups.entries()];
  }, [perUnitRows]);

  const isFiltered = !!(selectedMonth || selectedVendor || selectedCategory || selectedItem);
  const empty = now.expenseCount === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Reports</h1>
        <p className="page-description mt-1">
          Fiscal year runs Shawwal → the following Ramadan on the Fatimi/Misri Hijri calendar.
        </p>
      </div>

      <ReportFilters
        fiscalYears={fiscalYears}
        currentFy={currentFy}
        selectedFy={selectedFy}
        months={months}
        selectedMonth={selectedMonth}
        vendors={vendors}
        selectedVendor={selectedVendor}
        categories={categories}
        selectedCategory={selectedCategory}
        items={items}
        selectedItem={selectedItem}
        isFiltered={isFiltered}
      />

      {empty ? (
        <p className="rounded-xl border border-ink/10 bg-white/60 px-4 py-8 text-center text-sm text-ink/55">
          Nothing recorded for {periodLabel}
          {isFiltered && " with these filters"}.
        </p>
      ) : (
        <>
          {/* ---------------- headline ---------------- */}
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
                    {spendDelta > 0 ? "more than" : spendDelta < 0 ? "less than" : "vs"} {previousLabel}
                    {before && ` (${formatMoney(before.spend)})`}
                  </span>
                </p>
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
                // GST is recorded per expense, not per line, so under a
                // category or item filter it would describe the whole receipt
                // and overstate this slice. Show something true instead.
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

          {/* ---------------- insights ---------------- */}
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

          {/* ---------------- spend over time ---------------- */}
          {!selectedMonth && monthly.length > 1 && (
            <Panel
              title="Spend over time"
              subtitle="By month, using the receipt date where there is one"
            >
              <ColumnChart
                data={monthly.map((m) => ({
                  key: m.key,
                  label: m.label,
                  value: m.spend,
                  count: m.count,
                }))}
                valueFormat={formatMoney}
              />
            </Panel>
          )}

          {/* ---------------- breakdowns ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Spend by category"
              onExport={() =>
                downloadCsv(
                  "spend-by-category.csv",
                  categorySpend.map((c) => ({ category: c.label, lines: c.count, total: c.spend }))
                )
              }
            >
              <BarChart
                data={categorySpend.map((c) => ({ label: c.label, value: c.spend, count: c.count }))}
                valueFormat={formatCompact}
              />
            </Panel>

            <Panel
              title="Spend by vendor"
              onExport={() =>
                downloadCsv(
                  "spend-by-vendor.csv",
                  vendorSpend.map((v) => ({ vendor: v.label, expenses: v.count, total: v.spend }))
                )
              }
            >
              <BarChart
                data={vendorSpend.map((v) => ({ label: v.label, value: v.spend, count: v.count }))}
                valueFormat={formatCompact}
              />
            </Panel>

            <Panel
              title="Top items"
              subtitle="Across every vendor in this slice"
              onExport={() =>
                downloadCsv(
                  "spend-by-item.csv",
                  itemSpend.map((i) => ({ item: i.label, lines: i.count, total: i.spend }))
                )
              }
            >
              <BarChart
                data={itemSpend.map((i) => ({ label: i.label, value: i.spend, count: i.count }))}
                valueFormat={formatCompact}
              />
            </Panel>

            <Panel title="Where it sits" subtitle="Expenses by stage, excluding declined">
              <StackedBar
                data={statusMix.map((s) => ({
                  label: s.label,
                  value: s.spend,
                  detail: formatCompact(s.spend),
                  // Fixed per stage, so a filter that empties one doesn't
                  // repaint the others.
                  slot: STATUS_SLOT[s.key] ?? 0,
                }))}
              />
            </Panel>
          </div>

          {/* ---------------- the table view ---------------- */}
          <Panel
            title="The numbers"
            subtitle="Every figure above, in full — the chart colours are a guide, this is the record"
          >
            {/* The monthly figures live only in the column chart's hover
                otherwise, and a value reachable only by hovering is not
                reachable at all for a keyboard or screen-reader user. */}
            {monthly.length > 1 && !selectedMonth && (
              <div className="mb-5 overflow-x-auto">
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
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                    <th className="py-2 pr-4 font-medium">Category</th>
                    <th className="py-2 pr-4 text-right font-medium">Lines</th>
                    <th className="py-2 pr-4 text-right font-medium">Total</th>
                    <th className="py-2 pr-4 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {categorySpend.map((c) => (
                    <tr key={c.key} className="border-b border-ink/5 last:border-0">
                      <td className="py-1.5 pr-4">{c.label}</td>
                      <td className="py-1.5 pr-4 text-right font-mono text-ink/60 tabular-nums">{c.count}</td>
                      <td className="py-1.5 pr-4 text-right font-mono tabular-nums">{formatMoney(c.spend)}</td>
                      <td className="py-1.5 pr-4 text-right font-mono text-ink/60 tabular-nums">
                        {now.spend > 0 ? `${Math.round((c.spend / now.spend) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-ink/15 font-medium">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{now.lineCount}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{formatMoney(now.spend)}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ---------------- per-unit trends ---------------- */}
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
                    onClick={() => setCalendar(c)}
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
            {groupedPerUnit.length === 0 ? (
              <p className="text-sm text-ink/50">
                No per-unit data here yet. It appears once a receipt line is matched to a pricelist
                item with confirmed pack contents.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {groupedPerUnit.map(([groupName, rows]) => {
                  const series = perUnitVendorSeries(rows);
                  const datedPoints = series.reduce((n, s) => n + s.points.length, 0);
                  return (
                  <div key={groupName}>
                    <h3 className="mb-2 text-sm font-medium text-ink">{groupName}</h3>
                    {datedPoints >= 2 ? (
                      <LineChart
                        series={series}
                        valueFormat={(v) => `$${v.toFixed(4)}`}
                        height={150}
                      />
                    ) : (
                      // A line through one point is not a trend. Say what the
                      // single figure is and wait for a second purchase.
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
        </>
      )}
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
          <h2 className="section-title text-ink">{title}</h2>
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
