"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatHijri } from "@/lib/hijri/hijri";
import { hijriOfIso } from "@/lib/periods";
import { formatDate } from "@/lib/format";
import type { FilterOption } from "./report-filters";
import { ReportFilterBar, type FilterKey } from "./report-filter-bar";
import { ReportTableView } from "@/components/report-table";
import { spendReportTables, type transactionsPage } from "@/lib/reporting/spend-tables";

type TransactionsPage = NonNullable<ReturnType<typeof transactionsPage>>;
import { SECTIONS, buildHref, type ReportQuery } from "@/lib/reporting/query";
import { PrintRegistryProvider, Printable } from "./printable";
import {
  percentChange,
  MAX_COMPARE_SUBJECTS,
  type Bucket,
  type Comparison,
  type Dimension,
  type Insight,
  type MonthBreakdown,
} from "@/lib/reporting/aggregate";
import type { SpendReport } from "@/lib/reporting/spend-report";
import type { ReportTable } from "@/lib/reporting/tables";
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
} from "./charts";
import { perUnitVendorSeries, type AverageUnitCost, type PerUnitRow } from "@/lib/reporting/unit-costs";

/** Palette slot per stage, fixed so colour follows the stage and not its rank. */
const STATUS_SLOT: Record<string, number> = {
  submitted: 0,
  approved: 1,
  paid: 2,
};

function DateCell({ date, calendar }: { date: string | null; calendar: "gregorian" | "hijri" }) {
  if (!date) return <>—</>;
  if (calendar === "gregorian") return <>{formatDate(date)}</>;
  return <>{formatHijri(hijriOfIso(date))}</>;
}

/**
 * Draws a report the server has already worked out (lib/reporting/spend-report).
 * Nothing here computes a figure: the page sends the figures, not the rows.
 *
 * The tables on the page are the ones its downloads are made of
 * (lib/reporting/spend-tables), drawn by the table every report uses — so
 * what is on screen and what is in the file are one definition, and every
 * table here sorts and pages the same way.
 */
export function ReportsView({
  query,
  report,
  today,
  earliest,
  vendors,
  categories,
  items,
  periodLabel,
  previousLabel,
  hasCategoryOrItemFilter,
  transactions,
  header,
  filters,
}: {
  query: ReportQuery;
  report: SpendReport;
  today: string;
  earliest: string | null;
  vendors: FilterOption[];
  categories: FilterOption[];
  items: FilterOption[];
  periodLabel: string;
  previousLabel: string;
  hasCategoryOrItemFilter: boolean;
  /** One page of the transactions, when that section is showing. */
  transactions: TransactionsPage | null;
  /** The top of the page (report-header) with its buttons, drawn on the server. */
  header: React.ReactNode;
  /** Which of the standard filters this report takes (its registry entry). */
  filters: FilterKey[];
}) {
  const [calendar, setCalendar] = useState<"gregorian" | "hijri">("gregorian");

  const { now, before, monthly, insights: found, section } = report;

  const spendDelta = before ? percentChange(now.spend, before.spend) : null;
  const countDelta = before ? percentChange(now.expenseCount, before.expenseCount) : null;

  const empty = now.expenseCount === 0;
  const isFiltered = query.vendors.length > 0 || query.categories.length > 0 || query.items.length > 0;

  // The section's own table, first of the ones its download holds. Transactions
  // arrive already cut to a page, so that section brings its own.
  const mainTable = useMemo(
    () => (section.key === "transactions" ? null : (spendReportTables(report, periodLabel, previousLabel)[0] ?? null)),
    [report, section.key, periodLabel, previousLabel]
  );

  return (
    <PrintRegistryProvider>
      <div className="flex flex-col gap-5">
        {header}

        {/* One filter row, above every section — so whichever part you are on,
            the numbers describe the same slice. Which part comes first. */}
        <ReportFilterBar
          filters={filters}
          period={query.period}
          today={today}
          earliest={earliest}
          options={{ vendors, categories, items }}
          selected={{ vendors: query.vendors, categories: query.categories, items: query.items }}
          counting={query.status}
          lead={
            <div className="flex basis-full flex-col gap-1 text-support">
              <span className="font-medium text-ink/70">Section</span>
              <nav aria-label="Report sections" className="segmented flex-wrap self-start">
                {SECTIONS.map((s) => (
                  <Link
                    key={s.key}
                    href={buildHref(query, { section: s.key })}
                    aria-current={s.key === query.section ? "page" : undefined}
                    className="segment py-[0.4rem]"
                  >
                    {s.label}
                  </Link>
                ))}
              </nav>
            </div>
          }
        />

        {empty ? (
          <p className="card px-4 py-6 text-center text-body text-ink/70">
            Nothing recorded for {periodLabel}
            {isFiltered && " with these filters"}.
          </p>
        ) : (
          <>
            {/* The headline rides above every section: whatever you are looking
                at, the total it belongs to stays in view. */}
            <Printable id="headline" label="Headline totals">
              <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="flex flex-col justify-center rounded-[0.625rem] border border-gold/30 bg-gold/[0.07] px-[1.1rem] py-4">
                  <HeroFigure
                    label={`Total spend · ${periodLabel}`}
                    value={formatMoney(now.spend)}
                    caption={`${now.expenseCount} ${now.expenseCount === 1 ? "expense" : "expenses"}, ${now.lineCount} ${now.lineCount === 1 ? "line" : "lines"}`}
                  />
                  {spendDelta != null && previousLabel && (
                    <p className="mt-2 text-support text-ink/70">
                      <span className="font-semibold text-ink">
                        <span aria-hidden="true">{spendDelta > 0 ? "↑" : spendDelta < 0 ? "↓" : "→"}</span>{" "}
                        {Math.abs(Math.round(spendDelta * 100))}%
                      </span>{" "}
                      {spendDelta > 0 ? "more than" : spendDelta < 0 ? "less than" : "vs"} {previousLabel}
                      {before && ` (${formatMoney(before.spend)})`}
                    </p>
                  )}
                  {isFiltered && <p className="mt-1.5 text-support text-ink/70">Filtered — not the whole period.</p>}
                  {/* A discount is a line of its own with no category, so a
                      category or item filter never keeps it: these figures are
                      before it, and say by how much. */}
                  {report.discountsLeftOut < 0 && (
                    <p className="mt-1 text-support text-ink/70">
                      Before {formatMoney(-report.discountsLeftOut)} of discounts on these receipts, which have no
                      category of their own.
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
                  {/* GST is on every line, so it holds under any filter. Older
                      lines had it shared out across their receipt; say so
                      when they are in play and the split is by category. */}
                  <StatTile
                    label="GST"
                    value={formatMoney(now.gst)}
                    hint={
                      hasCategoryOrItemFilter && now.apportionedGstLines > 0
                        ? `On the matching lines — ${now.apportionedGstLines} older ${now.apportionedGstLines === 1 ? "line has" : "lines have"} GST estimated from the receipt total`
                        : hasCategoryOrItemFilter
                          ? `On the ${now.lineCount} matching ${now.lineCount === 1 ? "line" : "lines"}`
                          : "Included in total spend"
                    }
                  />
                </div>
              </section>
            </Printable>

            {section.key === "overview" && (
              <OverviewSection
                monthly={monthly}
                found={found}
                statusMix={section.statusMix}
                hijri={report.calendar === "hijri"}
                table={mainTable}
              />
            )}
            {section.key === "breakdown" && (
              <BreakdownSection
                query={query}
                dimension={section.dimension}
                ranked={section.ranked}
                overTime={section.overTime}
                table={mainTable}
              />
            )}
            {section.key === "compare" && (
              <CompareSection
                query={query}
                dimension={section.dimension}
                comparison={section.comparison}
                chosenCount={section.chosenCount}
                optionCount={
                  section.dimension === "item"
                    ? items.length
                    : section.dimension === "category"
                      ? categories.length
                      : vendors.length
                }
                unitCostByItem={section.unitCostByItem}
                table={mainTable}
              />
            )}
            {section.key === "unit-costs" && (
              <UnitCostsSection perUnitRows={section.rows} calendar={calendar} onCalendarChange={setCalendar} />
            )}
            {section.key === "transactions" && (
              <TransactionsSection page={transactions} />
            )}
          </>
        )}
      </div>
    </PrintRegistryProvider>
  );
}

/* ------------------------------------------------------------------ */

function OverviewSection({
  monthly,
  found,
  statusMix,
  hijri,
  table,
}: {
  monthly: Bucket[];
  found: Insight[];
  statusMix: Bucket[];
  /** Months are Hijri months — a Hijri period's are. */
  hijri: boolean;
  /** Spend by month, as the download has it. */
  table: ReportTable | null;
}) {
  return (
    <>
      {found.length > 0 && (
        <Printable id="overview-insights" label="What stands out">
          <Panel title="What stands out">
            <ul className="flex flex-col gap-1.5">
              {found.map((insight) => (
                <li key={insight.text} className="flex gap-2 text-body text-ink">
                  <span aria-hidden="true" className="text-ink/45">
                    {insight.tone === "up" ? "↑" : insight.tone === "down" ? "↓" : "•"}
                  </span>
                  {insight.text}
                </li>
              ))}
            </ul>
          </Panel>
        </Printable>
      )}

      {monthly.length > 1 && (
        <Printable id="overview-spend-over-time" label="Spend over time">
          <Panel
            title="Spend over time"
            subtitle={`By ${hijri ? "Hijri " : ""}month, using the receipt date where there is one`}
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
            {/* Monthly figures in full, so they are never hover-only. */}
            {table && (
              <div className="mt-5 border-t border-ink/[0.08] pt-4">
                <ReportTableView table={table} />
              </div>
            )}
          </Panel>
        </Printable>
      )}

      <Printable id="overview-status" label="Where it sits">
        <Panel title="Where it sits" subtitle="Expenses by stage. Declined and withdrawn ones are not spend and are not counted.">
          <StackedBar
            data={statusMix.map((s) => ({
              label: s.label,
              value: s.spend,
              detail: formatCompact(s.spend),
              slot: STATUS_SLOT[s.key] ?? 0,
            }))}
          />
        </Panel>
      </Printable>
    </>
  );
}

/* ------------------------------------------------------------------ */

const BREAKDOWN_CONFIG: Record<Dimension, { title: string; choice: string }> = {
  category: { title: "Categories", choice: "Categories" },
  vendor: { title: "Vendors", choice: "Vendors" },
  item: { title: "Items", choice: "Items" },
};

/** Two or three ways of cutting the same section, as one control: a choice of what to group by. */
function DimensionChoice({
  label,
  choices,
  current,
  href,
}: {
  label: string;
  choices: readonly (readonly [Dimension, string])[];
  current: Dimension;
  href: (dimension: Dimension) => string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {choices.map(([value, text]) => (
        <Link key={value} href={href(value)} aria-current={current === value ? "true" : undefined} className="segment" scroll={false}>
          {text}
        </Link>
      ))}
    </div>
  );
}

/**
 * Categories, Vendors and Items are the same question asked of a different
 * column: how does it rank, how did it move month to month, and what are the
 * exact figures. One dimension picker rather than three tabs — the same
 * pattern Compare already uses for choosing what to group by.
 */
function BreakdownSection({
  query,
  dimension,
  ranked,
  overTime,
  table,
}: {
  query: ReportQuery;
  dimension: Dimension;
  ranked: Bucket[];
  overTime: MonthBreakdown;
  /** The ranking in full, as the download has it. */
  table: ReportTable | null;
}) {
  const config = BREAKDOWN_CONFIG[dimension];

  const selectedCount =
    dimension === "category"
      ? query.categories.length
      : dimension === "vendor"
        ? query.vendors.length
        : query.items.length;

  return (
    <>
      <Printable id="breakdown-chart" label={`Spend by ${dimension}`}>
        <Panel
          title={`Spend by ${dimension}`}
          subtitle={
            selectedCount > 0
              ? `Only the ${config.title.toLowerCase()} chosen in the filters above`
              : "The largest, with each one's share of the total"
          }
          action={
            <DimensionChoice
              label="Break down by"
              choices={[
                ["category", BREAKDOWN_CONFIG.category.choice],
                ["vendor", BREAKDOWN_CONFIG.vendor.choice],
                ["item", BREAKDOWN_CONFIG.item.choice],
              ]}
              current={dimension}
              href={(value) => buildHref(query, { breakdownBy: value })}
            />
          }
        >
          <BarChart data={ranked.map((b) => ({ label: b.label, value: b.spend, count: b.count }))} maxBars={12} />
        </Panel>
      </Printable>

      {overTime.months.length > 1 && (
        <Printable id="breakdown-time" label={`${config.title} over time`}>
          <Panel
            title={`${config.title} over time`}
            subtitle={`Each month split by ${dimension}${
              overTime.foldedCount > 0 ? ` — the smallest ${overTime.foldedCount} are grouped` : ""
            }`}
          >
            <StackedColumnChart months={overTime.months} series={overTime.series} />
          </Panel>
        </Printable>
      )}

      {table && (
        <Printable id="breakdown-table" label={`${config.title} — the numbers`}>
          <Panel title="The numbers" subtitle="The record — chart colours are only a guide">
            <ReportTableView table={table} />
          </Panel>
        </Printable>
      )}
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
  dimension,
  comparison,
  chosenCount,
  optionCount,
  unitCostByItem,
  table,
}: {
  query: ReportQuery;
  dimension: Dimension;
  comparison: Comparison;
  chosenCount: number;
  optionCount: number;
  unitCostByItem: Record<string, AverageUnitCost>;
  /** Month by month, side by side, as the download has it. */
  table: ReportTable | null;
}) {
  const usingDefaults = chosenCount === 0;
  const overCap = chosenCount > MAX_COMPARE_SUBJECTS;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-[26rem] text-support text-ink/70">
          {usingDefaults
            ? `Showing the top ${comparison.subjects.length} by spend — pick specific ${dimension}s in the filters above to choose your own.`
            : `Comparing ${comparison.subjects.length} of ${optionCount}.`}{" "}
          {comparison.subjects.length > 0 &&
            `One card each, on one scale, so heights can be compared: it tops out at ${formatMoney(comparison.sharedMax)} a month.`}
        </p>
        <DimensionChoice
          label="Compare by"
          choices={[
            ["item", "Items"],
            ["category", "Categories"],
            ["vendor", "Vendors"],
          ]}
          current={dimension}
          href={(value) => buildHref(query, { compareBy: value })}
        />
      </div>

      {overCap && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-support text-ink">
          {chosenCount} selected, showing the first {MAX_COMPARE_SUBJECTS}. Past that the cards get
          too narrow to read and the palette runs out of hues that stay distinct for colourblind
          readers.
        </p>
      )}

      {comparison.subjects.length === 0 ? (
        <p className="card px-4 py-6 text-center text-body text-ink/70">Nothing to compare with the current filters.</p>
      ) : (
        <>
          <Printable id="compare-cards" label="Compare cards">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {comparison.subjects.map((s, i) => {
                const unitCost = dimension === "item" ? unitCostByItem[s.key] : undefined;
                return (
                  <div key={s.key} className="card px-[1.1rem] py-4">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesHue(i) }} />
                      <p className="min-w-0 text-body font-semibold break-words text-ink">{s.label}</p>
                    </div>

                    <p className="mt-1.5 text-[1.6rem] leading-[1.1] font-semibold tracking-tight text-ink">{formatMoney(s.total)}</p>
                    <p className="mt-1 text-support text-ink/70">
                      {s.occurrences} {occurrenceNoun(dimension, s.occurrences)}
                      {unitCost && ` · $${unitCost.average.toFixed(2)}/${unitCost.unit} avg`}
                    </p>

                    <div className="mt-3.5">
                      <SmallMultiple months={comparison.months} values={s.values} sharedMax={comparison.sharedMax} slot={i} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Printable>

          {table && (
            <Printable id="compare-table" label="Compare — the numbers">
              <Panel title="The numbers" subtitle="Side by side, in full">
                <ReportTableView table={table} />
              </Panel>
            </Printable>
          )}
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

/**
 * Every line behind the figures, a page at a time. The server has sorted and
 * cut it (lib/reporting/spend-tables transactionsPage); a heading or the
 * pager asks it for another page. The totals row is of every line, which is
 * the headline's figure.
 */
function TransactionsSection({ page }: { page: TransactionsPage | null }) {
  if (!page) return null;
  const { table, view } = page;
  return (
    <Printable id="transactions" label="Transactions">
      <Panel
        title="Transactions"
        subtitle={`${view.total.toLocaleString()} ${view.total === 1 ? "line" : "lines"} — select a heading to sort; the Excel and CSV downloads have every one`}
      >
        <ReportTableView table={table} server={view} empty="No lines in this period with these filters." />
      </Panel>
    </Printable>
  );
}

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
  const disputedCount = perUnitRows.filter((r) => r.disputed).length;

  return (
    <Panel
      title="Per-unit cost trends"
      subtitle="What we actually pay per box or pack, and per kilo, litre or item — compare vendors within an item"
      action={
        <div className="segmented" role="group" aria-label="Dates shown as">
          {(["gregorian", "hijri"] as const).map((c) => (
            <button key={c} type="button" onClick={() => onCalendarChange(c)} aria-pressed={calendar === c} className="segment">
              {c === "gregorian" ? "Gregorian dates" : "Hijri dates"}
            </button>
          ))}
        </div>
      }
    >
      {grouped.length === 0 ? (
        <p className="text-body text-ink/70">
          No per-unit data here yet. It appears once a receipt line is matched to a pricelist item
          with confirmed pack contents.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {disputedCount > 0 && (
            <p className="max-w-3xl text-support text-ink/70">
              {disputedCount} {disputedCount === 1 ? "purchase is" : "purchases are"} left out of the
              trends and averages: the pack&rsquo;s contents and the receipt disagree by five times or
              more, so the per-unit figure can&rsquo;t be trusted — the Pricelist leaves{" "}
              {disputedCount === 1 ? "it" : "them"} out too. Marked &ldquo;pack in doubt&rdquo; below.
            </p>
          )}
          {grouped.map(([groupName, rows]) => {
            const series = perUnitVendorSeries(rows);
            const datedPoints = series.reduce((n, s) => n + s.points.length, 0);
            return (
              <Printable key={groupName} id={`unit-cost-${groupName}`} label={`Unit cost — ${groupName}`}>
                <div className="border-t border-ink/[0.08] pt-5 first:border-0 first:pt-0">
                  <h3 className="mb-2 text-body font-semibold text-ink">{groupName}</h3>
                  {datedPoints >= 2 ? (
                    <LineChart series={series} valueFormat={(v) => `$${v.toFixed(2)}`} height={150} />
                  ) : (
                    <p className="text-support text-ink/70">A trend appears once there are two dated purchases to compare.</p>
                  )}
                  {/* The purchases behind the line. The date can be read in
                      either calendar, which the shared report table cannot
                      do, so this one keeps its own rows in the same dress. */}
                  <div className="mt-3 max-w-4xl overflow-x-auto">
                    {/* Fixed columns, so the same column sits in the same place under every item down the page. */}
                    <table className="w-full min-w-[34rem] table-fixed text-body">
                      <thead>
                        <tr className="border-b border-ink/15 text-left text-support text-ink/70">
                          <th scope="col" className="w-[38%] pr-4 pb-2 font-semibold">Vendor</th>
                          <th scope="col" className="w-[20%] pr-4 pb-2 font-semibold">Date</th>
                          <th scope="col" className="w-[14%] pr-4 pb-2 text-right font-semibold">Quantity</th>
                          <th scope="col" className="w-[14%] pr-4 pb-2 text-right font-semibold">Per pack</th>
                          <th scope="col" className="w-[14%] pb-2 text-right font-semibold">Per unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-b border-ink/[0.06] last:border-0 hover:bg-gold/[0.07]">
                            <td className="py-2 pr-4">{r.vendorName}</td>
                            <td className="py-2 pr-4 whitespace-nowrap text-ink/70 tabular-nums">
                              <DateCell date={r.receiptDate} calendar={calendar} />
                            </td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                              {r.normalizedQuantity} {r.normalizedUnit}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.perPack != null ? `$${r.perPack.toFixed(2)}` : "—"}</td>
                            <td className="py-2 text-right font-medium tabular-nums">
                              {r.disputed ? (
                                <span className="badge badge-muted" title="The pack's contents and the receipt disagree by five times or more">
                                  pack in doubt
                                </span>
                              ) : (
                                `$${r.perUnit.toFixed(2)}`
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Printable>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-[1.1rem]">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-support text-ink/70">{subtitle}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
      </div>
      {children}
    </section>
  );
}
