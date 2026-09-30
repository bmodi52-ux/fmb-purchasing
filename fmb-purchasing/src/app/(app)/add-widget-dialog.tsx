"use client";

import { useEffect, useState } from "react";
import { parsePeriod, periodCode, yearContaining } from "@/lib/periods";
import { PeriodPicker } from "@/components/period-picker";
import type { Dimension } from "@/lib/reporting/aggregate";
import { STATUS_BASES, type StatusBasis } from "@/lib/reporting/basis";
import type { WidgetData } from "@/lib/reporting/widget-data";
import {
  WIDGET_REPORT_LABEL,
  WIDGET_VIEWS,
  widgetView,
  type WidgetReport,
  type WidgetSpec,
  type WidgetView,
} from "@/lib/reporting/widgets";
import { MultiSelectMenu } from "./reports/multi-select-menu";
import { fetchWidgetOptions, previewWidget, type WidgetOptions } from "./reports/preview-data-actions";
import { addDashboardWidget, updateDashboardWidget } from "./reports/dashboard-widgets-actions";
import { WidgetBody } from "./widget-body";
import { Dialog } from "@/components/dialog";
import type { SavedWidget } from "./home-dashboard";

const DIMENSIONS: { value: Dimension; label: string; pluralLabel: string }[] = [
  { value: "category", label: "Category", pluralLabel: "Categories" },
  { value: "vendor", label: "Vendor", pluralLabel: "Vendors" },
  { value: "item", label: "Item", pluralLabel: "Items" },
];

const REPORT_ORDER: WidgetReport[] = ["spend", "money-out", "exceptions"];

const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Building a widget is choosing a piece of a report and the settings its page
 * would have (lib/reporting/widgets). The preview is that report's own loader,
 * run on the server exactly as the home page will run it.
 */
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
  const q = editing?.spec.query ?? {};
  const [view, setView] = useState<WidgetView>(editing?.spec.view ?? "spend-over-time");
  const [title, setTitle] = useState(editing?.title ?? widgetView("spend-over-time")!.label);
  // Once someone types a title it is theirs; until then it follows the choice.
  const [titleTouched, setTitleTouched] = useState(!!editing);
  // New widgets follow the current Hijri year and roll over by themselves.
  const [periodChoice, setPeriodChoice] = useState(first(q.period) ?? "h-current");
  const [status, setStatus] = useState<StatusBasis>((first(q.status) as StatusBasis) ?? "committed");
  const [vendorIds, setVendorIds] = useState<string[]>(list(q.vendor));
  const [categoryIds, setCategoryIds] = useState<string[]>(list(q.category));
  const [itemIds, setItemIds] = useState<string[]>(list(q.item));
  const [breakdownBy, setBreakdownBy] = useState<Dimension>((first(q.breakdownBy) as Dimension) ?? "category");
  const [compareBy, setCompareBy] = useState<Dimension>((first(q.compareBy) as Dimension) ?? "item");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = widgetView(view)!;
  const needs = (n: (typeof def.needs)[number]) => def.needs.includes(n);
  const isSpend = def.report === "spend";

  // The filter menus for the period on screen, fetched once per period.
  const [options, setOptions] = useState<WidgetOptions | null>(null);
  // The preview as the server computed it, and for which widget.
  const [preview, setPreview] = useState<{ key: string; period: string; data: WidgetData | null } | null>(null);

  // Whole years can follow whichever year is current ("h-current"); anything
  // else is fixed to the dates chosen.
  const resolved = parsePeriod(periodChoice, today);
  const rolling = /-current$/.test(periodChoice);
  const isCurrentWholeYear =
    resolved.calendar !== null && resolved.part.type === "year" && resolved.year === yearContaining(resolved.calendar, today);

  // Cleared the moment the period changes (during render, not in an effect —
  // the supported way to react to a changed value without an extra render
  // pass) so the menus below never offer one period's vendors under another.
  const [seenPeriod, setSeenPeriod] = useState(periodChoice);
  if (periodChoice !== seenPeriod) {
    setSeenPeriod(periodChoice);
    setOptions(null);
  }

  useEffect(() => {
    if (!isSpend) return;
    let cancelled = false;
    fetchWidgetOptions(periodChoice).then((data) => {
      if (!cancelled) setOptions(data);
    });
    return () => {
      cancelled = true;
    };
  }, [periodChoice, isSpend]);

  // A unit-cost widget follows one item, chosen on its own.
  const unitItem = needs("item") ? itemIds[0] : undefined;

  const query: Record<string, string | string[]> = {};
  if (needs("period")) query.period = periodChoice;
  if (isSpend) {
    if (status !== "committed") query.status = status;
    if (needs("breakdownBy")) query.breakdownBy = breakdownBy;
    if (needs("compareBy")) query.compareBy = compareBy;
    query.vendor = vendorIds;
    query.category = categoryIds;
    query.item = needs("item") ? (unitItem ? [unitItem] : []) : itemIds;
  }
  const spec: WidgetSpec = { report: def.report, view, query };

  // The widget exactly as it would be saved: asked for again whenever any of
  // it changes, and computed on the server just as the home page will.
  const previewKey = JSON.stringify(spec);
  const previewReady = (!isSpend || options != null) && (!needs("item") || !!unitItem);

  useEffect(() => {
    if (!previewReady) return;
    const asked = JSON.parse(previewKey) as WidgetSpec;
    let cancelled = false;
    // A short pause, so a run of ticks in a filter menu asks once.
    const timer = setTimeout(() => {
      previewWidget(asked).then((result) => {
        if (!cancelled) setPreview({ key: previewKey, period: String(asked.query.period ?? ""), data: result?.data ?? null });
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, previewReady]);

  // Last figures stay up while new ones are on their way — but only for the
  // same period, so one period's figures never sit under another's label.
  const samePeriod = preview?.period === String(query.period ?? "");
  const previewData = previewReady && samePeriod ? (preview?.data ?? null) : null;
  const previewStale = previewData != null && preview?.key !== previewKey;

  function chooseView(next: WidgetView) {
    setView(next);
    if (!titleTouched) setTitle(widgetView(next)!.label);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (editing) await updateDashboardWidget(editing.id, spec, title);
      else await addDashboardWidget(spec, title);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The widget could not be saved.");
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
          <span className="text-ink/55">What to show</span>
          <select value={view} onChange={(e) => chooseView(e.target.value as WidgetView)} className="input text-sm">
            {REPORT_ORDER.map((report) => (
              <optgroup key={report} label={WIDGET_REPORT_LABEL[report]}>
                {WIDGET_VIEWS.filter((v) => v.report === report).map((v) => (
                  <option key={v.view} value={v.view}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/55">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            className="input text-sm"
            placeholder="What should this card be called?"
          />
        </label>

        {needs("period") ? (
          <div className="flex flex-col gap-2">
            <PeriodPicker
              value={periodChoice}
              today={today}
              earliest={earliest}
              onChange={(code) => {
                setPeriodChoice(code);
                setVendorIds([]);
                setCategoryIds([]);
                setItemIds([]);
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
          </div>
        ) : (
          <p className="text-xs text-ink/50">As of the day it is looked at — no period to choose.</p>
        )}

        {isSpend && (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Which expenses</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusBasis)}
                className="input max-w-[14rem] text-sm"
              >
                {STATUS_BASES.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.short}
                  </option>
                ))}
              </select>
            </label>

            {needs("breakdownBy") && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink/55">Broken down by</span>
                <select
                  value={breakdownBy}
                  onChange={(e) => setBreakdownBy(e.target.value as Dimension)}
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

            {needs("compareBy") && (
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

            {needs("item") && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink/55">Item</span>
                <select
                  value={unitItem ?? ""}
                  onChange={(e) => setItemIds(e.target.value ? [e.target.value] : [])}
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
          </div>
        )}

        {isSpend && (
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
            {!needs("item") && (
              <MultiSelectMenu label="Items" options={options?.itemOptions ?? []} selected={itemIds} onApply={setItemIds} />
            )}
          </div>
        )}

        <div className="rounded-xl border border-ink/10 bg-cream/60 p-3">
          <p className="mb-2 text-xs text-ink/45">Preview{previewStale && " · updating…"}</p>
          {previewData ? (
            <div className={previewStale ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <WidgetBody data={previewData} />
            </div>
          ) : (
            <p className="text-sm text-ink/50">
              {needs("item") && !unitItem ? "Choose an item to preview." : "Loading…"}
            </p>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink/10 pt-4">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-ink/60 hover:text-ink">
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
