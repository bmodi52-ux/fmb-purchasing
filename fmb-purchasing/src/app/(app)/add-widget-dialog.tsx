"use client";

import { useEffect, useState } from "react";
import { parsePeriod, periodCode, yearContaining } from "@/lib/periods";
import { PeriodPicker } from "@/components/period-picker";
import { formatMonthLabel, type Dimension } from "@/lib/reporting/aggregate";
import { MultiSelectMenu } from "./reports/multi-select-menu";
import {
  widgetPeriodCode,
  WIDGET_KINDS,
  type WidgetConfig,
  type WidgetData,
  type WidgetKind,
  type StatMetric,
} from "./reports/dashboard-widgets";
import { fetchWidgetOptions, previewWidget, type WidgetOptions } from "./reports/preview-data-actions";
import { addDashboardWidget, updateDashboardWidget } from "./reports/dashboard-widgets-actions";
import { WidgetBody } from "./widget-body";
import { Dialog } from "@/components/dialog";
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
  today,
  earliest,
  onClose,
}: {
  editing: SavedWidget | null;
  today: string;
  earliest: string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<WidgetKind>(editing?.kind ?? "spend-over-time");
  const [title, setTitle] = useState(editing?.title ?? WIDGET_KINDS[0].label);
  // New widgets follow the current Hijri year and roll over by themselves.
  const [periodChoice, setPeriodChoice] = useState(editing ? widgetPeriodCode(editing.config) : "h-current");
  // A month from a widget saved before periods; cleared as soon as the period changes.
  const [month, setMonth] = useState(editing?.config.month ?? "");
  const [vendorIds, setVendorIds] = useState<string[]>(editing?.config.vendorIds ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(editing?.config.categoryIds ?? []);
  const [itemIds, setItemIds] = useState<string[]>(editing?.config.itemIds ?? []);
  const [dimension, setDimension] = useState<Dimension>(editing?.config.dimension ?? "category");
  const [compareBy, setCompareBy] = useState<Dimension>(editing?.config.compareBy ?? "item");
  const [itemId, setItemId] = useState<string | undefined>(editing?.config.itemId);
  const [statMetric, setStatMetric] = useState<StatMetric>(editing?.config.statMetric ?? "spend");
  const [saving, setSaving] = useState(false);

  // The filter menus for the period on screen, fetched once per period.
  const [options, setOptions] = useState<WidgetOptions | null>(null);
  // The preview as the server computed it, and for which widget and period.
  const [preview, setPreview] = useState<{ key: string; period: string; data: WidgetData } | null>(null);

  // Whole years can follow whichever year is current ("h-current"); anything
  // else is fixed to the dates chosen.
  const resolved = parsePeriod(periodChoice, today);
  const rolling = /-current$/.test(periodChoice);
  const isCurrentWholeYear =
    resolved.calendar !== null &&
    resolved.part.type === "year" &&
    resolved.year === yearContaining(resolved.calendar, today);

  // Cleared the moment the period changes (during render, not in an effect —
  // the supported way to react to a changed value without an extra render
  // pass) so the menus below never offer one period's vendors under another.
  const [seenPeriod, setSeenPeriod] = useState(periodChoice);
  if (periodChoice !== seenPeriod) {
    setSeenPeriod(periodChoice);
    setOptions(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetchWidgetOptions(periodChoice).then((data) => {
      if (!cancelled) setOptions(data);
    });
    return () => {
      cancelled = true;
    };
  }, [periodChoice]);

  const needsDimension = NEEDS_DIMENSION.includes(kind);
  const needsCompareBy = NEEDS_COMPARE_BY.includes(kind);
  const needsItem = NEEDS_ITEM.includes(kind);
  const needsStatMetric = NEEDS_STAT_METRIC.includes(kind);

  const config: WidgetConfig = {
    period: periodChoice,
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
    itemLabel: needsItem ? options?.itemOptions.find((o) => o.value === itemId)?.label : undefined,
    statMetric: needsStatMetric ? statMetric : undefined,
  };

  // The widget exactly as it would be saved: the preview is asked for again
  // whenever any of it changes, and computed on the server just as the home
  // page will compute it.
  const previewKey = JSON.stringify([kind, config]);
  const previewReady = options != null && (!needsItem || !!itemId);

  useEffect(() => {
    if (!previewReady) return;
    const [k, c] = JSON.parse(previewKey) as [WidgetKind, WidgetConfig];
    let cancelled = false;
    // A short pause, so a run of ticks in a filter menu asks once.
    const timer = setTimeout(() => {
      previewWidget(k, c).then((data) => {
        if (!cancelled) setPreview({ key: previewKey, period: c.period ?? "", data });
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, previewReady]);

  // Last figures stay up while new ones are on their way — but only for the
  // same period, so one period's figures never sit under another's label.
  const previewData = previewReady && preview?.period === periodChoice ? preview.data : null;
  const previewStale = previewData != null && preview?.key !== previewKey;

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
    <Dialog
      title={editing ? "Edit widget" : "Add a widget"}
      onClose={onClose}
      className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-ink/15 bg-white p-5 shadow-lg"
    >

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

          <div className="flex flex-col gap-2">
            <PeriodPicker
              value={periodChoice}
              today={today}
              earliest={earliest}
              onChange={(code) => {
                setPeriodChoice(code);
                setMonth("");
                setVendorIds([]);
                setCategoryIds([]);
                setItemIds([]);
                setItemId(undefined);
              }}
            />
            {isCurrentWholeYear && resolved.calendar && (
              <label className="flex items-center gap-2 text-xs text-ink/65">
                <input
                  type="checkbox"
                  checked={rolling}
                  onChange={(e) =>
                    setPeriodChoice(
                      e.target.checked
                        ? `${resolved.calendar === "hijri" ? "h" : resolved.calendar}-current`
                        : periodCode(resolved.calendar!, resolved.year!)
                    )
                  }
                />
                Move on to the new year automatically
              </label>
            )}
            {month && (
              <p className="text-xs text-ink/50">
                Saved with only {formatMonthLabel(month)} — choose a period to replace it.
              </p>
            )}
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
                {options?.itemOptions.map((o) => (
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
              options={options?.vendorOptions ?? []}
              selected={vendorIds}
              onApply={setVendorIds}
            />
            <MultiSelectMenu
              label="Categories"
              options={options?.categoryOptions ?? []}
              selected={categoryIds}
              onApply={setCategoryIds}
            />
            <MultiSelectMenu
              label="Items"
              options={options?.itemOptions ?? []}
              selected={itemIds}
              onApply={setItemIds}
            />
          </div>

          <div className="rounded-xl border border-ink/10 bg-cream/60 p-3">
            <p className="mb-2 text-xs text-ink/45">Preview{previewStale && " · updating…"}</p>
            {previewData ? (
              <div className={previewStale ? "opacity-60 transition-opacity" : "transition-opacity"}>
                <WidgetBody data={previewData} />
              </div>
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
            className="btn btn-primary btn-sm"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add to dashboard"}
          </button>
        </div>
    </Dialog>
  );
}
