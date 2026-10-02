"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ReportTile } from "@/components/report-tile";
import { labelEvery, niceScale, sharePercent, shortMoney, splitName, wholeMoney } from "@/lib/reporting/chart-scale";

/**
 * Chart marks for the reports, the dashboard and the widgets on Home.
 *
 * A chart is drawn to be read without touching it: its scale is labelled, a
 * column says what it comes to, a ranking gives each name in full with its
 * amount and its share. Pointing at something adds detail (the cents, the
 * number of expenses); it is never the only way to a figure.
 *
 * Colour:
 *
 *   One series is the brand colour — teal on the live site, the crest's
 *   maroon on the sandbox (globals.css) — so a chart belongs to the page it
 *   is on. Both are well over 4.5:1 on a white card. Gold is kept for what
 *   is selected and what a figure is compared with.
 *
 *   A chart split into parts uses the categorical palette below, which was
 *   validated rather than eyeballed (`validate_palette.js`): worst adjacent
 *   CVD ΔE 9.1, worst adjacent normal-vision ΔE 19.6. Four slots sit under
 *   3:1 contrast, which obliges relief — so every chart using these hues has
 *   a legend with amounts, never colour alone. The folded tail, "Other", is
 *   grey: it is not a thing, and should not look like one.
 *
 *   Text never wears a data colour.
 */
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const BRAND = "var(--color-brand)";
const OTHER = "rgb(43 33 28 / 0.22)";
/** The card a chart sits on, for the rings that separate one mark from the next. */
const SURFACE = "#FFFFFF";
const GRID = "rgba(43,33,28,0.08)";
const INK = "#2B211C";
/** A period that is not over yet: the same colour, broken, so it is not read as a fall. */
const UNDER_WAY = `repeating-linear-gradient(135deg, ${BRAND} 0 4px, color-mix(in srgb, ${BRAND} 55%, white) 4px 8px)`;

/** aggregate.ts folds the series past the palette's ceiling into one, under this key. */
const OTHER_KEY = "__other__";

/**
 * The hue for a categorical slot, for callers that need to draw their own
 * swatch beside a chart. Exported rather than duplicated so there is one
 * palette in the file, not one per component.
 */
export function seriesHue(slot: number): string {
  return CATEGORICAL[slot % CATEGORICAL.length];
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}

/** Compact for axis ticks and dense labels, where full precision is noise. */
export function formatCompact(n: number): string {
  return shortMoney(n);
}

/** A name with the heading it sits under said quietly after it: "Chicken · Meat & Poultry". */
function Name({ label }: { label: string }) {
  const [name, under] = splitName(label);
  return (
    <>
      {name}
      {under && <span className="text-support text-ink/55"> · {under}</span>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

/** The one number a report leads with. Exactly one per view. */
export function HeroFigure({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div>
      <p className="text-support font-medium text-ink/70">{label}</p>
      {/* Proportional figures, not tabular: at display size tabular digits
          make a number like 121 look gappy. */}
      <p className="mt-1 text-[clamp(2.25rem,1.6rem+2.4vw,3rem)] leading-none font-semibold tracking-tight text-ink">
        {value}
      </p>
      {caption && <p className="mt-1.5 text-body text-ink/70">{caption}</p>}
    </div>
  );
}

/** 12-point trend line under a stat tile. Context, not a readable chart. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 24;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-5 w-full"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={BRAND} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * A headline number with optional change against a named period.
 *
 * The delta deliberately carries no red/green. On a spending dashboard
 * neither direction is inherently good — spending more in Ramadan is not a
 * regression — and the status palette is reserved for actual severity.
 * Direction is carried by an arrow and the named comparison instead.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  trend,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  trend?: number[];
  hint?: string;
}) {
  const showDelta = delta != null && Number.isFinite(delta);
  const hasTrend = !!trend && trend.length > 1;
  return (
    <ReportTile label={label} value={value}>
      {showDelta ? (
        <span>
          <strong>
            <span aria-hidden="true">{delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}</span> {Math.abs(Math.round(delta * 100))}%
          </strong>{" "}
          {delta > 0 ? "more than" : delta < 0 ? "less than" : "vs"} {deltaLabel}
        </span>
      ) : (
        hint && <span>{hint}</span>
      )}
      {hasTrend && (
        <span className="mt-auto block pt-2">
          <Sparkline points={trend} />
        </span>
      )}
    </ReportTile>
  );
}

/* ------------------------------------------------------------------ */
/* The frame of a column chart                                          */
/* ------------------------------------------------------------------ */

/**
 * What a chart says, for someone who cannot see it.
 *
 * Every chart in this file carried role="img" and no accessible name, which
 * announces as an unlabelled graphic — the screen-reader equivalent of a blank
 * rectangle. A chart cannot be described exhaustively in a label, so these say
 * the shape of the data and its extremes, which is what a sighted reader takes
 * from a glance, and leave the detail to the table or legend beside it.
 */
function chartSummary(
  kind: string,
  points: { label: string; value: number }[],
  format: (n: number) => string
): string {
  if (points.length === 0) return `${kind}, no data`;
  const top = points.reduce((a, b) => (b.value > a.value ? b : a));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  return (
    `${kind}, ${points.length} ${points.length === 1 ? "value" : "values"}. ` +
    `Highest ${top.label}, ${format(top.value)}. Total ${format(total)}.`
  );
}

/** Room above the scale for the figure on top of the tallest column. */
const HEADROOM = 22;

/**
 * What every column chart is drawn in: the scale down the left with its
 * figures, a hairline for each, the columns, and their names underneath.
 *
 * Laid out by the browser, not inside an SVG viewBox. A viewBox scales its
 * drawing to fit, which on a wide card left the chart a 600-unit island in
 * the middle and on a phone shrank its text to 5px; boxes in a grid are as
 * wide as their card and their text is the size it says.
 */
function Plot({
  height,
  top,
  ticks,
  tickFormat,
  names,
  label,
  tooltip,
  children,
}: {
  height: number;
  top: number;
  ticks: number[];
  tickFormat: (n: number) => string;
  names: { key: string; label: string }[];
  label: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
}) {
  const every = labelEvery(names.length);
  const columns = { gridTemplateColumns: `repeat(${names.length}, minmax(0, 1fr))` };
  // Up to a year of months need no year after their names: the period is
  // named above the chart, and "Rabi al-Awwal 1448" twelve times over is cut
  // short where "Rabi al-Awwal" fits. The full name is still what the pointer
  // is told, and what the table beside the chart says.
  const yearless = names.length <= 12 && names.every((n) => /\s\d{2,4}$/.test(n.label));
  const short = (name: string) => (yearless ? name.replace(/\s\d{2,4}$/, "") : name);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div aria-hidden="true" className="relative text-support text-ink/60 tabular-nums" style={{ height }}>
        {/* Holds the column as wide as its widest figure; the figures themselves are placed on their lines. */}
        <span className="invisible block">{tickFormat(top)}</span>
        <div className="absolute inset-x-0 bottom-0" style={{ top: HEADROOM }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / top) * 100}%` }}>
              {tickFormat(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="relative" style={{ height }} role="img" aria-label={label}>
        <div className="absolute inset-x-0 bottom-0" style={{ top: HEADROOM }}>
          {ticks.map((t) => (
            <span
              key={t}
              className={`absolute inset-x-0 border-t ${t === 0 ? "border-ink/30" : "border-ink/[0.08]"}`}
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 grid" style={columns}>
            {children}
          </div>
        </div>
        {tooltip}
      </div>

      <div />
      <div className="mt-2 grid text-center text-support text-ink/70" style={columns}>
        {names.map((n, i) => (
          <span key={n.key} className="min-w-0 truncate px-0.5" title={n.label}>
            {i % every === 0 ? short(n.label) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The reading that follows the pointer: above the column it is over. */
function PlotTip({ index, of, children }: { index: number; of: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-md border border-ink/10 bg-white px-2.5 py-1.5 text-support whitespace-nowrap shadow-md"
      style={{
        // Kept inside the card at either end, where a centred box would be cut off.
        left: `clamp(4.5rem, ${((index + 0.5) / of) * 100}%, calc(100% - 4.5rem))`,
        transform: "translateX(-50%)",
      }}
    >
      {children}
    </div>
  );
}

/** Whether there is room to print a figure over each column: always for a few, never for many. */
function valueLabelClass(columns: number): string | null {
  if (columns <= 6) return "";
  // Seven to twelve fit once the chart itself (not the screen) is wide enough.
  if (columns <= 12) return "hidden @xl:block";
  return null;
}

/* ------------------------------------------------------------------ */
/* Columns — magnitude over a time axis                                */
/* ------------------------------------------------------------------ */

export type ColumnDatum = {
  key: string;
  label: string;
  value: number;
  count?: number;
  /** The period this column stands for is not over: drawn broken, so a part-month is not read as a fall. */
  underWay?: boolean;
  /** What the same column came to in the period it is compared with: drawn as a gold mark across it. */
  compare?: number | null;
};

/**
 * Vertical columns for discrete time buckets. Single hue: the job here is
 * magnitude, so the months are not competing identities.
 */
export function ColumnChart({
  data,
  height = 220,
  valueFormat = formatMoney,
  tickFormat = shortMoney,
  emptyLabel = "No spend in this period.",
  label,
  seriesLabel,
  compareLabel,
}: {
  data: ColumnDatum[];
  height?: number;
  /** The figure in full, for the reading under the pointer. */
  valueFormat?: (n: number) => string;
  /** The figure shortened, for the scale and the top of each column. */
  tickFormat?: (n: number) => string;
  emptyLabel?: string;
  /** Overrides the generated description when the caller knows better. */
  label?: string;
  /** What the columns are, for the key: the period by name. */
  seriesLabel?: string;
  /** What the gold marks are, for the key and the reading under the pointer. */
  compareLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <p className="text-body text-ink/60">{emptyLabel}</p>;

  const compared = data.some((d) => d.compare != null);
  const anyUnderWay = data.some((d) => d.underWay);
  // The scale holds the marks as well as the columns, so a mark above its column is still on the chart.
  const { top, ticks } = niceScale(Math.max(...data.map((d) => Math.max(d.value, d.compare ?? 0))));
  const valueLabel = valueLabelClass(data.length);

  return (
    <div className="@container">
      <Plot
        height={height}
        top={top}
        ticks={ticks}
        tickFormat={tickFormat}
        names={data}
        label={label ?? chartSummary("Column chart of spend", data, valueFormat)}
        tooltip={
          hover != null && (
            <PlotTip index={hover} of={data.length}>
              <p className="font-semibold text-ink">{valueFormat(data[hover].value)}</p>
              <p className="text-ink/70">
                {data[hover].label}
                {data[hover].count != null && ` · ${data[hover].count} ${data[hover].count === 1 ? "expense" : "expenses"}`}
                {data[hover].underWay && " · still under way"}
              </p>
              {data[hover].compare != null && (
                <p className="text-ink/70">
                  {compareLabel ?? "Before"}: <span className="text-ink tabular-nums">{valueFormat(data[hover].compare!)}</span>
                </p>
              )}
            </PlotTip>
          )
        }
      >
        {data.map((d, i) => (
          <div
            key={d.key}
            // The whole band answers to the pointer, so it only has to be near the column, not on it.
            className={`relative flex h-full items-end justify-center ${hover === i ? "bg-ink/[0.035]" : ""}`}
            onPointerEnter={() => setHover(i)}
            // A tap fires leave the moment the finger lifts, which showed
            // the value for a frame. On touch it stays until the next tap.
            onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
          >
            {d.value > 0 && (
              <div
                // Up to 44px and never the whole band: the air between columns is what lets them be counted.
                className="relative w-[min(2.75rem,62%)] rounded-t-[4px]"
                style={{ height: `${Math.max((d.value / top) * 100, 0.8)}%`, background: d.underWay ? UNDER_WAY : BRAND }}
              >
                {valueLabel !== null && (
                  <span
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-1 text-support leading-none font-semibold whitespace-nowrap text-ink tabular-nums ${valueLabel}`}
                  >
                    {tickFormat(d.value)}
                  </span>
                )}
              </div>
            )}
            {d.compare != null && d.compare > 0 && (
              <span
                aria-hidden="true"
                className="absolute left-1/2 w-[min(3.9rem,84%)] -translate-x-1/2 border-t-2 border-gold-deep"
                style={{ bottom: `${(d.compare / top) * 100}%` }}
              />
            )}
          </div>
        ))}
      </Plot>

      {(compared || anyUnderWay) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-support text-ink/70">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BRAND }} />
            {seriesLabel ?? "This period"}
          </span>
          {compared && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-gold-deep" />
              {compareLabel ?? "The period before"}
            </span>
          )}
          {anyUnderWay && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: UNDER_WAY }} />
              Still under way
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked columns — magnitude over time, split by a dimension          */
/* ------------------------------------------------------------------ */

export type StackedColumnSeries = { key: string; label: string; values: number[] };

const seriesColour = (s: { key: string }, i: number) => (s.key === OTHER_KEY ? OTHER : CATEGORICAL[i % CATEGORICAL.length]);

/**
 * Spend per month, split into named parts.
 *
 * Categorical here, because the parts *are* the subject — this is the chart
 * that answers "which items drove that month". Segments are separated by a
 * 2px gap, and the legend is a small table of each part's amount and share,
 * which is the relief the palette's contrast WARN requires. It sits beside
 * the chart where the chart is wide enough, and under it where it is not.
 */
export function StackedColumnChart({
  months,
  series,
  height = 220,
  valueFormat = formatMoney,
  tickFormat = shortMoney,
  emptyLabel = "No spend in this period.",
  label,
}: {
  months: { key: string; label: string }[];
  series: StackedColumnSeries[];
  height?: number;
  valueFormat?: (n: number) => string;
  tickFormat?: (n: number) => string;
  emptyLabel?: string;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (months.length === 0 || series.length === 0) return <p className="text-body text-ink/60">{emptyLabel}</p>;

  const part = (s: StackedColumnSeries, i: number) => Math.max(0, s.values[i] ?? 0);
  const columnTotals = months.map((_, i) => series.reduce((sum, s) => sum + part(s, i), 0));
  const seriesTotals = series.map((s) => months.reduce((sum, _, i) => sum + part(s, i), 0));
  const grand = seriesTotals.reduce((a, b) => a + b, 0);
  const { top, ticks } = niceScale(Math.max(...columnTotals));

  return (
    <div className="@container">
      <div className="grid gap-x-8 gap-y-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)] @3xl:items-center">
        <Plot
          height={height}
          top={top}
          ticks={ticks}
          tickFormat={tickFormat}
          names={months}
          label={
            label ??
            // Described by month total rather than by series: the stack answers
            // "how much, when" first, and the legend beside it already names the
            // series with their own totals.
            chartSummary(
              `Stacked column chart of spend by ${series.length} ${series.length === 1 ? "part" : "parts"}`,
              months.map((m, i) => ({ label: m.label, value: columnTotals[i] ?? 0 })),
              valueFormat
            )
          }
          tooltip={
            hover != null && (
              <PlotTip index={hover} of={months.length}>
                <p className="mb-1 font-semibold text-ink">
                  {months[hover].label} — {valueFormat(columnTotals[hover])}
                </p>
                {series.map((s, i) =>
                  part(s, hover) > 0 ? (
                    <p key={s.key} className="flex items-center gap-1.5 text-ink/70">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: seriesColour(s, i) }} />
                      <span className="text-ink tabular-nums">{valueFormat(part(s, hover))}</span>
                      <span>{splitName(s.label)[0]}</span>
                    </p>
                  ) : null
                )}
              </PlotTip>
            )
          }
        >
          {months.map((m, i) => (
            <div
              key={m.key}
              className={`relative flex h-full items-end justify-center ${hover === i ? "bg-ink/[0.035]" : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
            >
              {columnTotals[i] > 0 && (
                <div
                  // Bottom-up, so the first (largest) series sits at the base and keeps its place as months change.
                  className="flex w-[min(2.75rem,62%)] flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                  style={{ height: `${Math.max((columnTotals[i] / top) * 100, 0.8)}%` }}
                >
                  {series.map((s, si) =>
                    part(s, i) > 0 ? (
                      <span key={s.key} className="block min-h-px" style={{ flex: `${part(s, i)} 1 0`, background: seriesColour(s, si) }} />
                    ) : null
                  )}
                </div>
              )}
            </div>
          ))}
        </Plot>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-2 text-body">
          {series.map((s, i) => (
            <Fragment key={s.key}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-sm" style={{ background: seriesColour(s, i) }} />
                <span className="min-w-0 break-words">
                  <Name label={s.label} />
                </span>
              </span>
              <span className="text-right font-medium tabular-nums">{wholeMoney(seriesTotals[i])}</span>
              <span className="min-w-[2.2rem] text-right text-support text-ink/70 tabular-nums">{sharePercent(seriesTotals[i], grand)}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small multiple — one subject's months, on a scale set elsewhere      */
/* ------------------------------------------------------------------ */

/**
 * One card of a comparison: a subject's monthly columns drawn against a
 * maximum passed in from outside.
 *
 * The shared maximum is the entire point. Scaled to its own peak, a subject
 * spending a tenth as much would look like it was keeping pace — which is
 * the standard way small multiples mislead. `slot` fixes the hue to the
 * subject so it survives a change of selection.
 */
export function SmallMultiple({
  months,
  values,
  sharedMax,
  slot,
  height = 84,
}: {
  months: { key: string; label: string }[];
  values: number[];
  sharedMax: number;
  slot: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const color = CATEGORICAL[slot % CATEGORICAL.length];

  if (months.length === 0) return <p className="text-support text-ink/60">No months in range.</p>;

  return (
    <div className="relative">
      <div
        className="flex items-end gap-[3px] border-b border-ink/30"
        style={{ height }}
        onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
      >
        {months.map((m, i) => {
          const v = values[i] ?? 0;
          const pct = (v / sharedMax) * 100;
          return (
            <div
              key={m.key}
              // Centred and width-capped: with only two or three months in
              // range, a full-width bar reads as a slab rather than a column.
              className="relative flex h-full flex-1 items-end justify-center"
              onPointerEnter={() => setHover(i)}
            >
              {v > 0 && (
                <div
                  className="w-full max-w-[26px] rounded-t-[4px]"
                  style={{
                    height: `${Math.max(pct, 1.5)}%`,
                    background: color,
                    opacity: hover === i ? 1 : 0.9,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Only the ends are labelled: at four cards wide there is no room for
          twelve month names, and the tooltip carries the rest. */}
      <div className="mt-1.5 flex justify-between text-support text-ink/60">
        <span>{months[0].label}</span>
        {months.length > 1 && <span>{months[months.length - 1].label}</span>}
      </div>

      {hover != null && (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-md border border-ink/10 bg-white px-2 py-1 text-support whitespace-nowrap shadow-md">
          <span className="font-semibold text-ink">{formatMoney(values[hover] ?? 0)}</span>
          <span className="text-ink/70"> · {months[hover].label}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bars — ranking by magnitude                                          */
/* ------------------------------------------------------------------ */

export type BarDatum = { label: string; value: number; count?: number };

/**
 * A ranking: each name in full, a bar for its size, its amount to the
 * dollar and its share. Names are long — "Chicken · Meat & Poultry",
 * "BANKSTOWN LEBANESE FRUIT & MIXED BUSINESS" — so they wrap onto a second
 * line rather than being cut short, and nothing has to be pointed at to be
 * read.
 */
export function BarChart({
  data,
  maxBars = 8,
  valueFormat = wholeMoney,
  emptyLabel = "No data.",
  total,
}: {
  data: BarDatum[];
  maxBars?: number;
  valueFormat?: (n: number) => string;
  emptyLabel?: string;
  /** What each row is a share of. Left out, it is everything in `data` — right when `data` is the whole list, not its top few. */
  total?: number;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.length > maxBars ? sorted.slice(0, maxBars - 1) : sorted;
  const rest = sorted.length > maxBars ? sorted.slice(maxBars - 1) : [];
  // Never invent a colour for a long tail — fold it into one honest row.
  const rows: (BarDatum & { other?: boolean })[] =
    rest.length > 0
      ? [...shown, { label: `Other (${rest.length})`, value: rest.reduce((s, d) => s + d.value, 0), other: true }]
      : shown;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const whole = total ?? data.reduce((s, d) => s + Math.max(0, d.value), 0);

  if (rows.length === 0) return <p className="text-body text-ink/60">{emptyLabel}</p>;

  return (
    <div className="@container">
      <div className="flex flex-col gap-2.5 text-body">
        {rows.map((r) => (
          // In a narrow card the name has a line to itself, over its bar and
          // figures; given the width, all four sit in one row. Either way the
          // amount and share columns are a fixed width, so they line up down
          // the list.
          <div
            key={r.label}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.4rem] items-center gap-x-3 gap-y-1 @md:grid-cols-[minmax(0,1.25fr)_minmax(2.5rem,1fr)_5.5rem_2.4rem]"
          >
            <span
              className="col-span-3 min-w-0 leading-snug break-words @md:col-span-1"
              title={r.count != null ? `${r.count} ${r.count === 1 ? "line" : "lines"}` : undefined}
            >
              <Name label={r.label} />
            </span>
            <span className="h-2 rounded-full bg-ink/[0.07]" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${r.value > 0 ? Math.max((r.value / max) * 100, 1.5) : 0}%`, background: r.other ? OTHER : BRAND }}
              />
            </span>
            <span className="text-right font-medium tabular-nums">{valueFormat(r.value)}</span>
            <span className="text-right text-support text-ink/70 tabular-nums">{sharePercent(r.value, whole)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lines — trend and per-unit comparison                                */
/* ------------------------------------------------------------------ */

export type LinePoint = { x: string; y: number };
export type LineSeriesData = { name: string; points: LinePoint[] };

/**
 * How wide an element is on screen. A line chart has to be an SVG, and an
 * SVG drawn to a fixed width is scaled to fit its box — so it is drawn to
 * the width it actually has, and its text is the size it says.
 */
function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Multi-series line/area chart with a labelled scale, a crosshair tooltip and a legend. */
export function LineChart({
  series,
  area = false,
  height = 200,
  xLabel,
  valueFormat = (v: number) => v.toFixed(2),
  label,
}: {
  series: LineSeriesData[];
  area?: boolean;
  height?: number;
  xLabel?: (x: string) => string;
  valueFormat?: (v: number) => string;
  label?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);

  // Never cycle the palette: a ninth hue is indistinguishable from an
  // existing one under CVD. Past the token ceiling the tail is dropped and
  // said out loud below the chart rather than silently recoloured.
  const drawn = series.slice(0, CATEGORICAL.length);
  const hidden = series.length - drawn.length;

  const allX = [...new Set(drawn.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const allY = drawn.flatMap((s) => s.points.map((p) => p.y));
  const { top: maxY, ticks } = niceScale(Math.max(0, ...allY));
  const colors = drawn.length === 1 ? [BRAND] : CATEGORICAL;

  // Room on the left for the scale's figures, by the longest of them.
  const tickWidth = Math.max(...ticks.map((t) => valueFormat(t).length)) * 7 + 10;
  const padding = { top: 18, right: 12, bottom: xLabel ? 24 : 8, left: tickWidth };
  const plotW = Math.max(60, width - padding.left - padding.right);
  const plotH = height - padding.top - padding.bottom;

  const xScale = (x: string) => {
    const i = allX.indexOf(x);
    return allX.length <= 1 ? plotW / 2 : (i / (allX.length - 1)) * plotW;
  };
  const yScale = (y: number) => plotH - (y / maxY) * plotH;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (allX.length === 0) return <p className="text-body text-ink/60">No data.</p>;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * plotW;
    let nearest = 0;
    let nearestDist = Infinity;
    allX.forEach((x, i) => {
      const d = Math.abs(xScale(x) - relX);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    setHoverIdx(nearest);
  }

  // As many dates along the bottom as there is room for, at about 64px each.
  const xEvery = xLabel ? labelEvery(allX.length, Math.max(2, Math.floor(plotW / 64))) : 0;

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
        role="img"
        aria-label={
          label ??
          chartSummary(
            `Line chart, ${series.length} series`,
            series.map((s) => ({
              label: s.name,
              value: s.points.reduce((sum, p) => sum + p.y, 0),
            })),
            valueFormat
          )
        }
      >
        <g transform={`translate(${padding.left},${padding.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={yScale(t)} y2={yScale(t)} stroke={t === 0 ? "rgba(43,33,28,0.3)" : GRID} strokeWidth={1} />
              <text x={-8} y={yScale(t) + 4} fontSize={12} textAnchor="end" fill={INK} opacity={0.6}>
                {valueFormat(t)}
              </text>
            </g>
          ))}

          {drawn.map((s, si) => {
            const color = colors[si % colors.length];
            const pts = s.points.filter((p) => allX.includes(p.x));
            if (pts.length === 0) return null;
            const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.y)}`).join(" ");
            const areaD =
              area && drawn.length === 1
                ? `${pathD} L ${xScale(pts[pts.length - 1].x)} ${plotH} L ${xScale(pts[0].x)} ${plotH} Z`
                : null;
            const last = pts[pts.length - 1];
            return (
              <g key={s.name}>
                {areaD && <path d={areaD} fill={color} opacity={0.1} stroke="none" />}
                <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
                ))}
                {/* One direct label per series, at the end — never a number
                    on every point. */}
                {drawn.length === 1 && (
                  <text x={xScale(last.x) - 4} y={yScale(last.y) - 10} fontSize={12} fontWeight={600} textAnchor="end" fill={INK}>
                    {valueFormat(last.y)}
                  </text>
                )}
              </g>
            );
          })}

          {hoverIdx != null && (
            <line
              x1={xScale(allX[hoverIdx])}
              x2={xScale(allX[hoverIdx])}
              y1={0}
              y2={plotH}
              stroke="rgba(43,33,28,0.25)"
              strokeWidth={1}
            />
          )}

          {xEvery > 0 &&
            allX.map((x, i) =>
              i % xEvery === 0 ? (
                <text
                  key={x}
                  x={xScale(x)}
                  y={plotH + 18}
                  fontSize={12}
                  // The ends are set from their own edge, so the first and last dates are not cut off.
                  textAnchor={allX.length > 1 && i === 0 ? "start" : allX.length > 1 && i === allX.length - 1 ? "end" : "middle"}
                  fill={INK}
                  opacity={0.7}
                >
                  {xLabel!(x)}
                </text>
              ) : null
            )}

          <rect
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={handleMove}
            // A tap is a pointerdown with no move; on touch the reading stays
            // until the next tap rather than vanishing as the finger lifts.
            onPointerDown={handleMove}
            onPointerLeave={(e) => e.pointerType !== "touch" && setHoverIdx(null)}
          />
        </g>
      </svg>

      {drawn.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-support text-ink/70">
          {drawn.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: colors[i % colors.length] }} />
              {s.name}
            </span>
          ))}
          {hidden > 0 && <span className="text-ink/55">+{hidden} more not shown</span>}
        </div>
      )}

      {hoverIdx != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-ink/10 bg-white px-2.5 py-1.5 text-support whitespace-nowrap shadow-md"
          style={{
            left: `clamp(4rem, ${xScale(allX[hoverIdx]) + padding.left}px, calc(100% - 4rem))`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="mb-1 text-ink/70">{xLabel ? xLabel(allX[hoverIdx]) : allX[hoverIdx]}</p>
          {drawn.map((s, i) => {
            const pt = s.points.find((p) => p.x === allX[hoverIdx]);
            if (!pt) return null;
            return (
              <p key={s.name} className="flex items-center gap-1.5 text-ink tabular-nums">
                <span className="inline-block h-0.5 w-2.5 shrink-0" style={{ background: colors[i % colors.length] }} />
                {valueFormat(pt.y)}
                {drawn.length > 1 && <span className="text-ink/70">{s.name}</span>}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked bar — part-to-whole across a small fixed set                 */
/* ------------------------------------------------------------------ */

export type StackDatum = {
  label: string;
  value: number;
  detail?: string;
  /**
   * Fixed palette slot for this class. Required, not derived from position:
   * colouring by index means a class disappearing from the data repaints
   * every class after it, so a reader who learned "paid is green" is misled
   * the moment a filter empties one stage.
   */
  slot: number;
};

/**
 * One horizontal stacked bar. Segments are separated by a 2px surface gap
 * rather than a stroke — white does the separating, so no ink is spent that
 * isn't data. The legend carries a value per class, which is the relief the
 * palette's contrast WARN requires.
 */
export function StackedBar({ data }: { data: StackDatum[] }) {
  const present = data.filter((d) => d.value > 0);
  const total = present.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-body text-ink/60">No data.</p>;

  // A single class is not a part-to-whole; a full-width bar at 100% is the
  // one-bar bar chart the spec warns about. Say it in words instead.
  if (present.length === 1) {
    return (
      <p className="text-body text-ink/70">
        All of it is <span className="font-semibold text-ink">{present[0].label.toLowerCase()}</span>
        {present[0].detail && <span> — {present[0].detail}</span>}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full">
        {present.map((d) => (
          <div
            key={d.label}
            style={{
              width: `${(d.value / total) * 100}%`,
              background: CATEGORICAL[d.slot % CATEGORICAL.length],
            }}
            className="h-full"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-body">
        {present.map((d) => (
          <span key={d.label} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: CATEGORICAL[d.slot % CATEGORICAL.length] }}
            />
            {d.label}
            <span className="font-medium tabular-nums">{d.detail ?? d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
