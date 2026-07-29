"use client";

import { useState } from "react";

/**
 * Chart marks for the Reports dashboard, built to the dataviz spec:
 * marks ≤24px with a 4px rounded data-end, 2px surface gaps and rings,
 * hairline recessive gridlines, and text that never wears the data colour.
 *
 * Palette provenance (validated, not eyeballed — `validate_palette.js`
 * against this app's own cream surface `#FBF6EC`):
 *
 *   Categorical passes every hard gate: worst adjacent CVD ΔE 9.1, worst
 *   adjacent normal-vision ΔE 19.6. Four slots sit under 3:1 contrast, which
 *   is a WARN that obliges *relief* — so every chart using these hues ships a
 *   legend with values or an accompanying table, never colour alone.
 *
 *   Sequential is FMB's own gold-deep at 3.69:1 on cream. Safe to brand
 *   because a magnitude chart carries one hue, so no adjacent-pair check
 *   applies. The brighter brand gold #D89C24 measures 2.24:1 and is not used
 *   for marks.
 */
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const GOLD = "#A97614";
/** Cream — the card surface, used for the gaps and rings that separate marks. */
const SURFACE = "#FBF6EC";
const GRID = "rgba(43,33,28,0.08)";
const INK = "#2B211C";

export function formatMoney(n: number): string {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}

/** Compact for axis ticks and dense labels, where full precision is noise. */
export function formatCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Top-rounded, square at the baseline — a column grows out of its axis. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

/** The one number the dashboard leads with. Exactly one per view. */
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
      <p className="text-sm text-ink/60">{label}</p>
      {/* Proportional figures, not tabular: at display size tabular digits
          make a number like 121 look gappy. */}
      <p className="mt-0.5 text-[clamp(2.25rem,1.6rem+2.4vw,3rem)] leading-none font-semibold tracking-tight text-ink">
        {value}
      </p>
      {caption && <p className="mt-1.5 text-sm text-ink/55">{caption}</p>}
    </div>
  );
}

/** 12-point trend line behind a stat tile. Context, not a readable chart. */
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
      <path d={d} fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.4} vectorEffect="non-scaling-stroke" />
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
  return (
    // Stacked rather than value-beside-sparkline: three of these share a row,
    // and at that width a 96px sparkline sitting next to the number pushed
    // itself over the delta text underneath.
    <div className="flex flex-col rounded-xl border border-ink/10 bg-white/60 p-4">
      <p className="text-xs text-ink/55">{label}</p>
      <p className="mt-1.5 text-2xl leading-none font-semibold text-ink">{value}</p>

      {showDelta ? (
        <p className="mt-2 text-xs text-ink/60">
          <span aria-hidden="true">{delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}</span>{" "}
          {Math.abs(Math.round(delta * 100))}%{" "}
          <span className="text-ink/45">
            {delta > 0 ? "more than" : delta < 0 ? "less than" : "vs"} {deltaLabel}
          </span>
        </p>
      ) : (
        hint && <p className="mt-2 text-xs leading-snug text-ink/45">{hint}</p>
      )}

      {trend && trend.length > 1 && (
        <div className="mt-auto pt-3">
          <Sparkline points={trend} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Columns — magnitude over a time axis                                */
/* ------------------------------------------------------------------ */

export type ColumnDatum = { key: string; label: string; value: number; count?: number };

/**
 * Vertical columns for discrete time buckets. Single hue: the job here is
 * magnitude, so the months are not competing identities.
 */
export function ColumnChart({
  data,
  height = 200,
  valueFormat = formatCompact,
  emptyLabel = "No spend in this period.",
}: {
  data: ColumnDatum[];
  height?: number;
  valueFormat?: (n: number) => string;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <p className="text-sm text-ink/50">{emptyLabel}</p>;

  const width = 600;
  // No bottom band for labels: they are rendered as HTML underneath, because
  // text inside the viewBox is scaled by the same factor as the chart — at
  // phone width a 10px SVG label lands at about 5px and is unreadable.
  const pad = { top: 16, right: 8, bottom: 4, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Headroom, so the tallest column doesn't sit flush against the top rule.
  const max = Math.max(...data.map((d) => d.value), 1) * 1.1;
  const band = plotW / data.length;
  // Capped at 24px and never filling the band — the leftover is the air the
  // spec asks for, and it holds the 2px separation at any column count.
  const barW = Math.min(24, Math.max(6, band - 10));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1={0} x2={plotW} y1={plotH * t} y2={plotH * t} stroke={GRID} strokeWidth={1} />
          ))}

          {data.map((d, i) => {
            const h = (d.value / max) * plotH;
            const x = i * band + (band - barW) / 2;
            const y = plotH - h;
            return (
              <g key={d.key}>
                <path d={columnPath(x, y, barW, h)} fill={GOLD} opacity={hover === i ? 1 : 0.85} />
                {/* Hit area spans the whole band and the full height, so the
                    pointer only has to be near the column, not on it. */}
                <rect
                  x={i * band}
                  y={0}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}

        </g>
      </svg>

      <div className="mt-1 flex">
        {data.map((d) => (
          <span
            key={d.key}
            className="min-w-0 flex-1 truncate text-center text-[11px] text-ink/50"
            style={{ flexBasis: `${100 / data.length}%` }}
          >
            {d.label}
          </span>
        ))}
      </div>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-ink/10 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(((hover + 0.5) * band + pad.left) / width) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-medium text-ink">{valueFormat(data[hover].value)}</p>
          <p className="text-ink/50">
            {data[hover].label}
            {data[hover].count != null &&
              ` · ${data[hover].count} ${data[hover].count === 1 ? "expense" : "expenses"}`}
          </p>
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
 * Horizontal bars for ranking. Long category and vendor names go horizontal
 * so the labels read straight rather than turned on their side.
 */
export function BarChart({
  data,
  maxBars = 8,
  valueFormat = formatCompact,
  emptyLabel = "No data.",
}: {
  data: BarDatum[];
  maxBars?: number;
  valueFormat?: (n: number) => string;
  emptyLabel?: string;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.length > maxBars ? sorted.slice(0, maxBars - 1) : sorted;
  const rest = sorted.length > maxBars ? sorted.slice(maxBars - 1) : [];
  // Never invent a colour for a long tail — fold it into one honest row.
  const rows =
    rest.length > 0
      ? [...shown, { label: `Other (${rest.length})`, value: rest.reduce((s, d) => s + d.value, 0) }]
      : shown;
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) return <p className="text-sm text-ink/50">{emptyLabel}</p>;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.label} className="group relative flex items-center gap-3">
          {/* Names are long — "Meat & Poultry › Mutton", "BANKSTOWN LEBANESE
              FRUIT & MIXED BUSINES" — so the label truncates and the whole
              row carries a hover with the full text. The value stays visible
              either way; it is never hover-only. */}
          <span className="w-24 shrink-0 truncate text-xs text-ink/70 sm:w-32">{r.label}</span>
          <div className="h-4 flex-1">
            <div
              className="h-4 rounded-r-[4px] transition-opacity group-hover:opacity-100"
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, background: GOLD, opacity: 0.85 }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-xs text-ink/70 tabular-nums">
            {valueFormat(r.value)}
          </span>

          <span
            role="tooltip"
            className="pointer-events-none absolute -top-1 left-0 z-10 hidden -translate-y-full rounded-md border border-ink/10 bg-white px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md group-hover:block"
          >
            <span className="font-medium text-ink">{r.label}</span>
            <span className="text-ink/55">
              {" — "}
              {valueFormat(r.value)}
              {r.count != null && ` · ${r.count} ${r.count === 1 ? "line" : "lines"}`}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lines — trend and per-unit comparison                                */
/* ------------------------------------------------------------------ */

export type LinePoint = { x: string; y: number };
export type LineSeriesData = { name: string; points: LinePoint[] };

/** Multi-series line/area chart with a crosshair tooltip and legend. */
export function LineChart({
  series,
  area = false,
  height = 200,
  xLabel,
  valueFormat = (v: number) => v.toFixed(2),
}: {
  series: LineSeriesData[];
  area?: boolean;
  height?: number;
  xLabel?: (x: string) => string;
  valueFormat?: (v: number) => string;
}) {
  const width = 600;
  const padding = { top: 10, right: 10, bottom: xLabel ? 22 : 6, left: 10 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Never cycle the palette: a ninth hue is indistinguishable from an
  // existing one under CVD. Past the token ceiling the tail is dropped and
  // said out loud below the chart rather than silently recoloured.
  const drawn = series.slice(0, CATEGORICAL.length);
  const hidden = drawn.length - drawn.length;

  const allX = [...new Set(drawn.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const allY = drawn.flatMap((s) => s.points.map((p) => p.y));
  // Headroom so the peak isn't welded to the top edge, and a floor so a
  // flat series doesn't divide by a zero range.
  const maxY = Math.max(1, ...allY) * 1.15;
  const colors = drawn.length === 1 ? [GOLD] : CATEGORICAL;

  const xScale = (x: string) => {
    const i = allX.indexOf(x);
    return allX.length <= 1 ? plotW / 2 : (i / (allX.length - 1)) * plotW;
  };
  const yScale = (y: number) => plotH - (y / maxY) * plotH;

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (allX.length === 0) return <p className="text-sm text-ink/50">No data.</p>;

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

  const showXTicks = !!xLabel && allX.length <= 14;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <g transform={`translate(${padding.left},${padding.top})`}>
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1={0} x2={plotW} y1={plotH * (1 - t)} y2={plotH * (1 - t)} stroke={GRID} strokeWidth={1} />
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
                  <text x={xScale(last.x) - 4} y={yScale(last.y) - 10} fontSize={11} textAnchor="end" fill={INK} opacity={0.7}>
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

          {showXTicks &&
            allX.map((x) => (
              <text key={x} x={xScale(x)} y={plotH + 16} fontSize={10} textAnchor="middle" fill={INK} opacity={0.5}>
                {xLabel!(x)}
              </text>
            ))}

          <rect
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIdx(null)}
          />
        </g>
      </svg>

      {drawn.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
          {drawn.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: colors[i % colors.length] }} />
              {s.name}
            </span>
          ))}
          {hidden > 0 && <span className="text-ink/40">+{hidden} more not shown</span>}
        </div>
      )}

      {hoverIdx != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-ink/10 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((xScale(allX[hoverIdx]) + padding.left) / width) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="mb-1 text-ink/50">{xLabel ? xLabel(allX[hoverIdx]) : allX[hoverIdx]}</p>
          {drawn.map((s, i) => {
            const pt = s.points.find((p) => p.x === allX[hoverIdx]);
            if (!pt) return null;
            return (
              <p key={s.name} className="flex items-center gap-1.5 font-mono text-ink">
                <span className="inline-block h-0.5 w-2.5 shrink-0" style={{ background: colors[i % colors.length] }} />
                {valueFormat(pt.y)}
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
  if (total === 0) return <p className="text-sm text-ink/50">No data.</p>;

  // A single class is not a part-to-whole; a full-width bar at 100% is the
  // one-bar bar chart the spec warns about. Say it in words instead.
  if (present.length === 1) {
    return (
      <p className="text-sm text-ink/70">
        All of it is <span className="font-medium text-ink">{present[0].label.toLowerCase()}</span>
        {present[0].detail && <span className="text-ink/50"> — {present[0].detail}</span>}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-5 w-full gap-[2px]">
        {present.map((d) => (
          <div
            key={d.label}
            style={{
              width: `${(d.value / total) * 100}%`,
              background: CATEGORICAL[d.slot % CATEGORICAL.length],
            }}
            className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {present.map((d) => (
          <span key={d.label} className="flex items-center gap-1.5 text-ink/70">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: CATEGORICAL[d.slot % CATEGORICAL.length] }}
            />
            {d.label}
            <span className="font-mono text-ink/45 tabular-nums">{d.detail ?? d.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
