"use client";

import type { WidgetData } from "./reports/dashboard-widgets";
import type { PerUnitRow } from "./reports/reports-view";
import {
  HeroFigure,
  ColumnChart,
  BarChart,
  StackedColumnChart,
  StackedBar,
  SmallMultiple,
  LineChart,
  seriesHue,
  formatMoney,
  formatCompact,
  type LineSeriesData,
} from "./reports/charts";

/** Palette slot per stage, fixed so colour follows the stage and not its rank — same mapping Reports uses. */
const STATUS_SLOT: Record<string, number> = {
  submitted: 0,
  approved: 1,
  paid: 2,
  declined: 3,
};

const STAT_LABEL: Record<string, string> = {
  spend: "Total spend",
  expenseCount: "Expenses",
  averageExpense: "Average expense",
  gst: "GST",
};

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

/** Renders whatever a saved (or previewed) widget's computed data calls for. */
export function WidgetBody({ data }: { data: WidgetData }) {
  switch (data.kind) {
    case "spend-over-time":
      if (data.monthly.length === 0) return <p className="text-sm text-ink/50">No spend in this period.</p>;
      return (
        <ColumnChart
          data={data.monthly.map((m) => ({ key: m.key, label: m.label, value: m.spend, count: m.count }))}
          valueFormat={formatMoney}
        />
      );

    case "status-mix":
      return (
        <StackedBar
          data={data.statusMix.map((s, i) => ({
            label: s.label,
            value: s.spend,
            detail: formatCompact(s.spend),
            slot: STATUS_SLOT[s.key] ?? i,
          }))}
        />
      );

    case "ranked-chart":
      return (
        <BarChart
          data={data.ranked.map((b) => ({ label: b.label, value: b.spend, count: b.count }))}
          maxBars={8}
          valueFormat={formatCompact}
        />
      );

    case "ranked-table":
      return <RankedTable ranked={data.ranked} dimension={data.dimension} />;

    case "breakdown-over-time":
      if (data.breakdown.months.length === 0)
        return <p className="text-sm text-ink/50">No spend in this period.</p>;
      return <StackedColumnChart months={data.breakdown.months} series={data.breakdown.series} />;

    case "compare-chart":
      return <CompareCards comparison={data.comparison} />;

    case "compare-table":
      return <CompareTable comparison={data.comparison} />;

    case "unit-cost-chart": {
      const series = perUnitVendorSeries(data.rows);
      const datedPoints = series.reduce((n, s) => n + s.points.length, 0);
      if (datedPoints < 2)
        return (
          <p className="text-xs text-ink/50">
            Not enough dated purchases yet — a trend appears once there is something to compare it
            against.
          </p>
        );
      return <LineChart series={series} valueFormat={(v) => `$${v.toFixed(4)}`} height={140} />;
    }

    case "unit-cost-table":
      return <UnitCostTable rows={data.rows} />;

    case "stat-tile": {
      const value =
        data.metric === "expenseCount"
          ? String(data.totals.expenseCount)
          : data.metric === "averageExpense"
            ? formatMoney(data.totals.averageExpense)
            : data.metric === "gst"
              ? formatMoney(data.totals.gst)
              : formatMoney(data.totals.spend);
      return (
        <HeroFigure
          label={STAT_LABEL[data.metric]}
          value={value}
          caption={`${data.totals.expenseCount} ${data.totals.expenseCount === 1 ? "expense" : "expenses"}`}
        />
      );
    }
  }
}

function RankedTable({
  ranked,
  dimension,
}: {
  ranked: { key: string; label: string; spend: number; count: number }[];
  dimension: string;
}) {
  const total = ranked.reduce((s, b) => s + b.spend, 0);
  const unit = dimension === "vendor" ? "expenses" : "lines";
  if (ranked.length === 0) return <p className="text-sm text-ink/50">No data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/55">
            <th className="py-1.5 pr-3 font-medium capitalize">{dimension}</th>
            <th className="py-1.5 pr-3 text-right font-medium">Total</th>
            <th className="py-1.5 text-right font-medium capitalize">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((b) => (
            <tr key={b.key} className="border-b border-ink/5 last:border-0">
              <td className="py-1 pr-3 truncate">{b.label}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums">{formatMoney(b.spend)}</td>
              <td className="py-1 text-right font-mono text-ink/60 tabular-nums">{b.count}</td>
            </tr>
          ))}
          <tr className="border-t border-ink/15 font-medium">
            <td className="py-1 pr-3">Total</td>
            <td className="py-1 pr-3 text-right font-mono tabular-nums">{formatMoney(total)}</td>
            <td className="py-1 text-right font-mono tabular-nums">
              {ranked.reduce((s, b) => s + b.count, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CompareCards({
  comparison,
}: {
  comparison: {
    months: { key: string; label: string }[];
    subjects: { key: string; label: string; total: number; values: number[] }[];
    sharedMax: number;
  };
}) {
  if (comparison.subjects.length === 0)
    return <p className="text-sm text-ink/50">Nothing to compare with these filters.</p>;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {comparison.subjects.map((s, i) => (
        <div key={s.key} className="rounded-lg border border-ink/10 bg-white/60 p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: seriesHue(i) }} />
            <p className="min-w-0 truncate text-xs font-medium text-ink">{s.label}</p>
          </div>
          <p className="mt-1 text-sm font-semibold text-ink">{formatMoney(s.total)}</p>
          <div className="mt-2">
            <SmallMultiple months={comparison.months} values={s.values} sharedMax={comparison.sharedMax} slot={i} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CompareTable({
  comparison,
}: {
  comparison: {
    months: { key: string; label: string }[];
    subjects: { key: string; label: string; total: number; values: number[] }[];
  };
}) {
  if (comparison.subjects.length === 0)
    return <p className="text-sm text-ink/50">Nothing to compare with these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/55">
            <th className="py-1.5 pr-3 font-medium">Month</th>
            {comparison.subjects.map((s) => (
              <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.months.map((m, i) => (
            <tr key={m.key} className="border-b border-ink/5 last:border-0">
              <td className="py-1 pr-3">{m.label}</td>
              {comparison.subjects.map((s) => (
                <td key={s.key} className="py-1 pr-3 text-right font-mono tabular-nums">
                  {s.values[i] > 0 ? formatMoney(s.values[i]) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitCostTable({ rows }: { rows: PerUnitRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-ink/50">No purchases in this slice yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-ink/45">
            <th className="py-1 pr-3 font-medium">Vendor</th>
            <th className="py-1 pr-3 text-right font-medium">Quantity</th>
            <th className="py-1 text-right font-medium">Per unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink/5">
              <td className="py-1 pr-3 truncate">{r.vendorName}</td>
              <td className="py-1 pr-3 text-right font-mono text-ink/60 tabular-nums">
                {r.normalizedQuantity} {r.normalizedUnit}
              </td>
              <td className="py-1 text-right font-mono tabular-nums">${r.perUnit.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
