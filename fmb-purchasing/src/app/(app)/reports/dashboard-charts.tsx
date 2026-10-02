"use client";

import type { BreakdownSeries } from "@/lib/reporting/aggregate";
import type { Ranked, TrendPoint } from "@/lib/reporting/dashboard";
import { BarChart, ColumnChart, StackedColumnChart, formatMoney } from "./charts";

/**
 * The dashboard's charts: the same chart components the Spending report
 * draws with, given the dashboard's figures. In the browser because the
 * charts take formatting functions and answer to a pointer; the figures are
 * worked out on the server and arrive ready.
 */

export function TrendChart({ points, label }: { points: TrendPoint[]; label: string }) {
  return (
    <ColumnChart
      data={points.map((p) => ({ key: p.key, label: p.label, value: p.value, count: p.count }))}
      valueFormat={formatMoney}
      height={220}
      label={label}
    />
  );
}

/** `total` is the period's whole spend: these are its ten largest, and each one's share is of all of it. */
export function RankedBars({ data, total }: { data: Ranked[]; total: number }) {
  return <BarChart data={data.map((d) => ({ label: d.label, value: d.value, count: d.count }))} maxBars={10} total={total} />;
}

export function OverTimeChart({ months, series }: { months: { key: string; label: string }[]; series: BreakdownSeries[] }) {
  return <StackedColumnChart months={months} series={series} />;
}
