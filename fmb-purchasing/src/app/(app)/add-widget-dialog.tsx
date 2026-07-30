"use client";

import { useEffect, useState } from "react";
import { formatFiscalYear } from "@/lib/fiscal-year";
import { monthKey, expenseDate, formatMonthLabel, type Dimension } from "./reports/aggregate";
import { MultiSelectMenu } from "./reports/multi-select-menu";
import {
  computeWidgetData,
  WIDGET_KINDS,
  type WidgetConfig,
  type WidgetKind,
  type StatMetric,
} from "./reports/dashboard-widgets";
import type { ReportRawData } from "./reports/data";
import { fetchWidgetPreviewData, type WidgetPreviewData } from "./reports/preview-data-actions";
import { addDashboardWidget, updateDashboardWidget } from "./reports/dashboard-widgets-actions";
import { WidgetBody } from "./widget-body";
import type { SavedWidget } from "./home-dashboard";

const STAT_METRICS: { value: StatMetric; label: string }[] = [
  { value: "spend", label: "Total spend" },
  { value: "expenseCount", label: "Expenses" },
  { value: "averageExpense", label: "Average expense" },
  { value: "gst", label: "GST" },
];

const DIMENSIONS: { value: Dimension; label: string; pluralLabel: string }[] = [
  { value: "category", label: "Category", pluralLabel: "Categories" },
  { value: "vendor", label: "Vendor", pluralLabel: "Vendors" },
  { value: "item", label: "Item", pluralLabel: "Items" },
];

const NEEDS_ITEM: WidgetKind[] = ["unit-cost-chart", "unit-cost-table"];
const NEEDS_COMPARE_BY: WidgetKind[] = ["compare-chart", "compare-table"];
const NEEDS_DIMENSION: WidgetKind[] = ["ranked-chart", "ranked-table", "breakdown-over-time"];
const NEEDS_STAT_METRIC: WidgetKind[] = ["stat-tile"];

export function AddWidgetDialog({
  editing,
  fiscalYears,
  currentFy,
  onClose,
}: {
  editing: SavedWidget | null;
  fiscalYears: number[];
  currentFy: number;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<WidgetKind>(editing?.kind ?? "spend-over-time");
  const [title, setTitle] = useState(editing?.title ?? WIDGET_KINDS[0].label);
  const [fy, setFy] = useState(editing?.config.fy ?? currentFy);
  const [month, setMonth] = useState(editing?.config.month ?? "");
  const [vendorIds, setVendorIds] = useState<string[]>(editing?.config.vendorIds ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(editing?.config.categoryIds ?? []);
  const [itemIds, setItemIds] = useState<string[]>(editing?.config.itemIds ?? []);
  const [dimension, setDimension] = useState<Dimension>(editing?.config.dimension ?? "category");
  const [compareBy, setCompareBy] = useState<Dimension>(editing?.config.compareBy ?? "item");
  const [itemId, setItemId] = useState<string | undefined>(editing?.config.itemId);
  const [statMetric, setStatMetric] = useState<StatMetric>(editing?.config.statMetric ?? "spend");
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<WidgetPreviewData | null>(null);

  // Cleared the moment fy changes (during render, not in an effect — the
  // supported way to react to a changed value without an extra render pass)
  // so the preview below never shows one fiscal year's figures under
  // another's label while the new fetch is still in flight.
  const [seenFy, setSeenFy] = useState(fy);
  if (fy !== seenFy) {
    setSeenFy(fy);
    setPreview(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetchWidgetPreviewData(fy).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [fy]);

  const monthsInYear = preview
    ? [...new Set(preview.expenses.map((e) => monthKey(expenseDate(e))))].sort()
    : [];

  const needsDimension = NEEDS_DIMENSION.includes(kind);
  const needsCompareBy = NEEDS_COMPARE_BY.includes(kind);
  const needsItem = NEEDS_ITEM.includes(kind);
  const needsStatMetric = NEEDS_STAT_METRIC.includes(kind);

  const config: WidgetConfig = {
    fy,
    month: month || null,
    vendorIds,
    categoryIds,
    itemIds,
    dimension: needsDimension ? dimension : undefined,
    compareBy: needsCompareBy ? compareBy : undefined,
    compareSubjectIds: needsCompareBy
      ? compareBy === "item"
        ? itemIds
        : compareBy === "vendor"
          ? vendorIds
          : categoryIds
      : undefined,
    itemId: needsItem ? itemId : undefined,
    itemLabel: needsItem ? preview?.itemOptions.find((o) => o.value === itemId)?.label : undefined,
    statMetric: needsStatMetric ? statMetric : undefined,
  };

  const raw: ReportRawData | null = preview
    ? {
        allExpenses: preview.expenses,
        allLines: preview.lines,
        paidCosts: preview.paidCosts,
        fyOf: new Map(preview.expenses.map((e) => [e.id, fy])),
      }
    : null;

  const previewReady = raw != null && (!needsItem || !!itemId);
  const previewData = previewReady ? computeWidgetData(kind, config, raw!) : null;

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await updateDashboardWidget(editing.id, { title, config });
      } else {
        await addDashboardWidget(kind, title, config);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-ink/15 bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="section-title text-ink">{editing ? "Edit widget" : "Add a widget"}</h2>
          <button type="button" onClick={onClose} className="text-ink/50 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input text-sm"
              placeholder="What should this card be called?"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Chart or table</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as WidgetKind)}
              className="input text-sm"
            >
              {WIDGET_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Fiscal year</span>
              <select
                value={String(fy)}
                onChange={(e) => {
                  setFy(Number(e.target.value));
                  setMonth("");
                  setVendorIds([]);
                  setCategoryIds([]);
                  setItemIds([]);
                  setItemId(undefined);
                }}
                className="input max-w-[11rem] text-sm"
              >
                {fiscalYears.map((y) => (
                  <option key={y} value={y}>
                    {formatFiscalYear(y)}
                    {y === currentFy ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="input max-w-[10rem] text-sm"
              >
                <option value="">Whole year</option>
                {monthsInYear.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {needsDimension && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Broken down by</span>
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value as Dimension)}
                className="input max-w-[11rem] text-sm"
              >
                {DIMENSIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {needsCompareBy && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Compare</span>
              <select
                value={compareBy}
                onChange={(e) => setCompareBy(e.target.value as Dimension)}
                className="input max-w-[11rem] text-sm"
              >
                {DIMENSIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.pluralLabel}
                  </option>
                ))}
              </select>
            </label>
          )}

          {needsItem && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Item</span>
              <select
                value={itemId ?? ""}
                onChange={(e) => setItemId(e.target.value || undefined)}
                className="input text-sm"
              >
                <option value="">Choose an item…</option>
                {preview?.itemOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {needsStatMetric && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Figure</span>
              <select
                value={statMetric}
                onChange={(e) => setStatMetric(e.target.value as StatMetric)}
                className="input max-w-[11rem] text-sm"
              >
                {STAT_METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-wrap gap-3">
            <MultiSelectMenu
              label="Vendors"
              options={preview?.vendorOptions ?? []}
              selected={vendorIds}
              onApply={setVendorIds}
            />
            <MultiSelectMenu
              label="Categories"
              options={preview?.categoryOptions ?? []}
              selected={categoryIds}
              onApply={setCategoryIds}
            />
            <MultiSelectMenu
              label="Items"
              options={preview?.itemOptions ?? []}
              selected={itemIds}
              onApply={setItemIds}
            />
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream/60 p-3">
            <p className="mb-2 text-xs text-ink/45">Preview</p>
            {previewData ? (
              <WidgetBody data={previewData} />
            ) : (
              <p className="text-sm text-ink/50">
                {needsItem && !itemId ? "Choose an item to preview." : "Loading…"}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink/10 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-ink/60 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !previewData || !title.trim()}
            className="rounded-md bg-gold px-4 py-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add to dashboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
