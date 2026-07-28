"use client";

import { useMemo, useState } from "react";
import { gregorianToHijri, formatHijri } from "@/lib/hijri/hijri.js";
import { formatDate } from "@/lib/format";
import { BarChart, LineChart, StackedBar, type LineSeriesData } from "./charts";

export type CategorySpend = { categoryName: string; total: number; count: number };
export type VendorSpend = { vendorName: string; total: number; count: number };
export type PerUnitRow = {
  groupName: string;
  vendorName: string;
  receiptDate: string | null;
  normalizedQuantity: number;
  normalizedUnit: string;
  perUnit: number;
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

function formatMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00`);
  return d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
}

/** One line per vendor within an item group, dated points only (chart needs a valid x). */
function perUnitVendorSeries(rows: PerUnitRow[]): LineSeriesData[] {
  const byVendor = new Map<string, PerUnitRow[]>();
  for (const r of rows) {
    if (!r.receiptDate) continue;
    const list = byVendor.get(r.vendorName) ?? [];
    list.push(r);
    byVendor.set(r.vendorName, list);
  }
  return [...byVendor.entries()].map(([vendorName, vendorRows]) => ({
    name: vendorName,
    points: [...vendorRows]
      .sort((a, b) => (a.receiptDate ?? "").localeCompare(b.receiptDate ?? ""))
      .map((r) => ({ x: r.receiptDate!, y: r.perUnit })),
  }));
}

export type SpendOverTimePoint = { x: string; y: number };
export type StatusBreakdownDatum = { label: string; value: number };

export function ReportsView({
  categorySpend,
  vendorSpend,
  perUnitRows,
  spendOverTime,
  statusBreakdown,
}: {
  categorySpend: CategorySpend[];
  vendorSpend: VendorSpend[];
  perUnitRows: PerUnitRow[];
  spendOverTime: SpendOverTimePoint[];
  statusBreakdown: StatusBreakdownDatum[];
}) {
  const [calendar, setCalendar] = useState<"gregorian" | "hijri">("gregorian");

  const groupedPerUnit = useMemo(() => {
    const groups = new Map<string, PerUnitRow[]>();
    for (const row of perUnitRows) {
      const list = groups.get(row.groupName) ?? [];
      list.push(row);
      groups.set(row.groupName, list);
    }
    return [...groups.entries()];
  }, [perUnitRows]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink/60">Calendar:</span>
        <button
          type="button"
          onClick={() => setCalendar("gregorian")}
          className={`rounded-md px-2 py-1 ${calendar === "gregorian" ? "bg-gold/20 text-ink" : "text-ink/50"}`}
        >
          Gregorian
        </button>
        <button
          type="button"
          onClick={() => setCalendar("hijri")}
          className={`rounded-md px-2 py-1 ${calendar === "hijri" ? "bg-gold/20 text-ink" : "text-ink/50"}`}
        >
          Hijri (Misri)
        </button>
      </div>

      <section>
        <h2 className="mb-2 section-title text-ink">Status breakdown</h2>
        <StackedBar data={statusBreakdown} />
      </section>

      <section>
        <h2 className="mb-2 section-title text-ink">Spend over time</h2>
        <LineChart
          series={[{ name: "Spend", points: spendOverTime }]}
          area
          xLabel={formatMonth}
          valueFormat={(v) => `$${v.toFixed(2)}`}
        />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title text-ink">Spend by category</h2>
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                "spend-by-category.csv",
                categorySpend.map((c) => ({ category: c.categoryName, total: c.total, count: c.count }))
              )
            }
            className="text-xs text-ink/60 underline hover:text-ink"
          >
            Download CSV
          </button>
        </div>
        {categorySpend.length === 0 ? (
          <p className="text-sm text-ink/50">No data for this fiscal year.</p>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-ink/10 bg-white/60 p-4">
              <BarChart data={categorySpend.map((c) => ({ label: c.categoryName, value: c.total }))} />
            </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="p-2">Category</th>
                <th className="p-2">Lines</th>
                <th className="p-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {categorySpend.map((c) => (
                <tr key={c.categoryName} className="border-t border-ink/10">
                  <td className="p-2">{c.categoryName}</td>
                  <td className="p-2 font-mono text-ink/60">{c.count}</td>
                  <td className="p-2 font-mono">${c.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="section-title text-ink">Spend by vendor</h2>
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                "spend-by-vendor.csv",
                vendorSpend.map((v) => ({ vendor: v.vendorName, total: v.total, count: v.count }))
              )
            }
            className="text-xs text-ink/60 underline hover:text-ink"
          >
            Download CSV
          </button>
        </div>
        {vendorSpend.length === 0 ? (
          <p className="text-sm text-ink/50">No data for this fiscal year.</p>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-ink/10 bg-white/60 p-4">
              <BarChart data={vendorSpend.map((v) => ({ label: v.vendorName, value: v.total }))} />
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="p-2">Vendor</th>
                  <th className="p-2">Expenses</th>
                  <th className="p-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {vendorSpend.map((v) => (
                  <tr key={v.vendorName} className="border-t border-ink/10">
                    <td className="p-2">{v.vendorName}</td>
                    <td className="p-2 font-mono text-ink/60">{v.count}</td>
                    <td className="p-2 font-mono">${v.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="section-title text-ink">Per-unit cost trends</h2>
            <p className="text-sm text-ink/60">
              $/unit over time per item, grouped across vendors and spelling variants. Compare vendors within a group.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
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
            }
            className="text-xs text-ink/60 underline hover:text-ink"
          >
            Download CSV
          </button>
        </div>
        {groupedPerUnit.length === 0 ? (
          <p className="text-sm text-ink/50">No per-unit data for this fiscal year yet.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groupedPerUnit.map(([groupName, rows]) => (
              <div key={groupName} className="rounded-lg border border-ink/10 bg-white/60 p-4">
                <h3 className="mb-2 font-medium text-ink">{groupName}</h3>
                <div className="mb-3">
                  <LineChart series={perUnitVendorSeries(rows)} valueFormat={(v) => `$${v.toFixed(4)}`} height={160} />
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50">
                      <th className="p-1">Vendor</th>
                      <th className="p-1">Date</th>
                      <th className="p-1">Qty</th>
                      <th className="p-1">$/unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-ink/5">
                        <td className="p-1">{r.vendorName}</td>
                        <td className="p-1 font-mono text-ink/60">
                          <DateCell date={r.receiptDate} calendar={calendar} />
                        </td>
                        <td className="p-1 font-mono text-ink/60">
                          {r.normalizedQuantity} {r.normalizedUnit}
                        </td>
                        <td className="p-1 font-mono">${r.perUnit.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
