"use client";

import { useState } from "react";

// Validated CVD-safe categorical palette (dataviz skill default) — used for
// genuinely multi-series identity charts (vendor comparison lines, status
// breakdown), since FMB's brand palette doesn't supply 8 validated hues.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
// Single-hue sequential: FMB gold-deep, safe to brand since magnitude charts
// carry only one hue (no adjacent-hue CVD check applies).
const GOLD = "#A97614";
const RING = "#FBF6EC"; // cream — surface ring around line-chart markers

function formatCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export type BarDatum = { label: string; value: number };

/** Horizontal bar chart, single hue — for ranking categories by magnitude. */
export function BarChart({ data, maxBars = 8 }: { data: BarDatum[]; maxBars?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.length > maxBars ? sorted.slice(0, maxBars - 1) : sorted;
  const rest = sorted.length > maxBars ? sorted.slice(maxBars - 1) : [];
  const otherTotal = rest.reduce((s, d) => s + d.value, 0);
  const rows = rest.length > 0 ? [...shown, { label: "Other", value: otherTotal }] : shown;
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) return <p className="text-sm text-ink/50">No data.</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-ink/70" title={r.label}>
              {r.label}
            </span>
            <div className="relative flex-1">
              <div
                className="h-4 rounded-r-[4px] opacity-90 transition-opacity hover:opacity-100"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: GOLD }}
                title={`${r.label}: ${formatCompact(r.value)}`}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-sm text-ink/70">{formatCompact(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

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

  const allX = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const colors = series.length === 1 ? [GOLD] : CATEGORICAL;

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
            <line
              key={t}
              x1={0}
              x2={plotW}
              y1={plotH * (1 - t)}
              y2={plotH * (1 - t)}
              stroke="rgba(43,33,28,0.08)"
              strokeWidth={1}
            />
          ))}

          {series.map((s, si) => {
            const color = colors[si % colors.length];
            const pts = s.points.filter((p) => allX.includes(p.x));
            if (pts.length === 0) return null;
            const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.y)}`).join(" ");
            const areaD =
              area && series.length === 1
                ? `${pathD} L ${xScale(pts[pts.length - 1].x)} ${plotH} L ${xScale(pts[0].x)} ${plotH} Z`
                : null;
            const last = pts[pts.length - 1];
            return (
              <g key={s.name}>
                {areaD && <path d={areaD} fill={color} opacity={0.1} stroke="none" />}
                <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={4} fill={color} stroke={RING} strokeWidth={2} />
                ))}
                {series.length === 1 && (
                  <text x={xScale(last.x) + 6} y={yScale(last.y) + 4} fontSize={11} fontFamily="var(--font-mono)" fill="#2B211C" opacity={0.7}>
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
              <text
                key={x}
                x={xScale(x)}
                y={plotH + 16}
                fontSize={10}
                textAnchor="middle"
                fill="#2B211C"
                opacity={0.5}
              >
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

      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3" style={{ background: colors[i % colors.length] }} />
              {s.name}
            </span>
          ))}
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
          <p className="mb-1 font-mono text-ink/50">{xLabel ? xLabel(allX[hoverIdx]) : allX[hoverIdx]}</p>
          {series.map((s, i) => {
            const pt = s.points.find((p) => p.x === allX[hoverIdx]);
            if (!pt) return null;
            return (
              <p key={s.name} className="flex items-center gap-1.5 font-mono text-ink">
                <span className="inline-block h-0.5 w-2.5" style={{ background: colors[i % colors.length] }} />
                {valueFormat(pt.y)}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type StackDatum = { label: string; value: number };

/** Single horizontal stacked bar — part-to-whole across a small fixed set of categories. */
export function StackedBar({ data }: { data: StackDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-sm text-ink/50">No data.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 w-full overflow-hidden rounded-md">
        {data.map((d, i) =>
          d.value > 0 ? (
            <div
              key={d.label}
              style={{ width: `${(d.value / total) * 100}%`, background: CATEGORICAL[i % CATEGORICAL.length] }}
              className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
              title={`${d.label}: ${d.value}`}
            />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
        {data.map((d, i) => (
          <span key={d.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
            {d.label} <span className="font-mono text-ink/40">({d.value})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
