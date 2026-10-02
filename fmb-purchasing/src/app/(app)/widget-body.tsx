"use client";

import type { WidgetData } from "@/lib/reporting/widget-data";
import { perUnitVendorSeries, type PerUnitRow } from "@/lib/reporting/unit-costs";
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
} from "./reports/charts";

/** Palette slot per stage, fixed so colour follows the stage and not its rank — same mapping Reports uses. */
const STATUS_SLOT: Record<string, number> = {
  submitted: 0,
  approved: 1,
  paid: 2,
};

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
      return <LineChart series={series} valueFormat={(v) => `$${v.toFixed(2)}`} height={140} />;
    }

    case "unit-cost-table":
      return <UnitCostTable rows={data.rows} />;

    case "figure":
      return (
        <HeroFigure
          label={data.label}
          value={data.format === "money" ? formatMoney(data.value) : String(data.value)}
          caption={data.caption}
        />
      );

    case "table":
      return <SmallTable data={data} />;
  }
}

/** A report's small table, its cells already in words. */
function SmallTable({ data }: { data: Extract<WidgetData, { kind: "table" }> }) {
  if (data.rows.length === 0) return <p className="text-sm text-ink/50">{data.empty}</p>;
  const align = (i: number) => (data.columns[i]?.numeric ? "text-right tabular-nums" : "");
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/55">
            {data.columns.map((c, i) => (
              <th scope="col" key={c.label} className={`py-1.5 pr-3 font-medium ${align(i)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri} className="border-b border-ink/5 last:border-0">
              {r.map((cell, i) => (
                <td key={i} className={`py-1 pr-3 ${align(i)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {data.total && (
            <tr className="border-t border-ink/15 font-medium">
              {data.total.map((cell, i) => (
                <td key={i} className={`py-1 pr-3 ${align(i)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
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
            <th scope="col" className="py-1.5 pr-3 font-medium capitalize">{dimension}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Total</th>
            <th scope="col" className="py-1.5 text-right font-medium capitalize">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((b) => (
            <tr key={b.key} className="border-b border-ink/5 last:border-0">
              <td className="py-1 pr-3 truncate">{b.label}</td>
              <td className="py-1 pr-3 text-right tabular-nums tabular-nums">{formatMoney(b.spend)}</td>
              <td className="py-1 text-right tabular-nums text-ink/60 tabular-nums">{b.count}</td>
            </tr>
          ))}
          <tr className="border-t border-ink/15 font-medium">
            <td className="py-1 pr-3">Total</td>
            <td className="py-1 pr-3 text-right tabular-nums tabular-nums">{formatMoney(total)}</td>
            <td className="py-1 text-right tabular-nums tabular-nums">
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
        <div key={s.key} className="card p-2.5">
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
            <th scope="col" className="py-1.5 pr-3 font-medium">Month</th>
            {comparison.subjects.map((s) => (
              <th scope="col" key={s.key} className="py-1.5 pr-3 text-right font-medium">
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
                <td key={s.key} className="py-1 pr-3 text-right tabular-nums tabular-nums">
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
            <th scope="col" className="py-1 pr-3 font-medium">Vendor</th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">Quantity</th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">Per pack</th>
            <th scope="col" className="py-1 text-right font-medium">Per unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink/5">
              <td className="py-1 pr-3 truncate">{r.vendorName}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-ink/60 tabular-nums">
                {r.normalizedQuantity} {r.normalizedUnit}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums text-ink/60 tabular-nums">
                {r.perPack != null ? `$${r.perPack.toFixed(2)}` : "—"}
              </td>
              <td className="py-1 text-right tabular-nums tabular-nums">
                {r.disputed ? <span className="text-ink/45">pack in doubt</span> : `$${r.perUnit.toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
