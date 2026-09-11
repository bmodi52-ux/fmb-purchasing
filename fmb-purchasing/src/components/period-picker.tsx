"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ALL_TIME,
  CALENDAR_LABELS,
  formatRange,
  formatRangeHijri,
  parsePeriod,
  partsOfYear,
  periodCode,
  previousPeriod,
  rangeCode,
  yearContaining,
  yearLabel,
  yearsToOffer,
  type CalendarKind,
  type PeriodPart,
} from "@/lib/periods";

type Mode = CalendarKind | "custom" | typeof ALL_TIME;

function partKey(part: PeriodPart): string {
  return part.type === "year" ? "year" : part.type === "quarter" ? `q${part.quarter}` : `m${part.month}`;
}

function partFromKey(key: string): PeriodPart {
  if (key.startsWith("q")) return { type: "quarter", quarter: Number(key.slice(1)) as 1 | 2 | 3 | 4 };
  if (key.startsWith("m")) return { type: "month", month: Number(key.slice(1)) };
  return { type: "year" };
}

/**
 * The one control for choosing a period, on every page that works by year
 * (scratchpad #22).
 *
 * Basic: which kind of year, which year, then the whole year, a quarter or a
 * month. Advanced: any range of dates. Underneath, the dates it covers in both
 * calendars, and shortcuts for the questions asked most.
 *
 * By default the choice goes into the page address as `?period=`, so a link,
 * a saved view and the Back button keep it. Pass `onChange` to use it inside a
 * form instead, as the dashboard widget builder does.
 */
export function PeriodPicker({
  value,
  today,
  earliest,
  allowAllTime = false,
  onChange,
  param = "period",
}: {
  value: string;
  /** Today in Sydney, from the server — never the viewer's own clock. */
  today: string;
  /** The earliest record, so the year lists start where the data does. */
  earliest: string | null;
  allowAllTime?: boolean;
  onChange?: (code: string) => void;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isAll = allowAllTime && value === ALL_TIME;
  const period = parsePeriod(isAll ? null : value, today);

  // Everything shown follows `value`, so the Back button and a link land on
  // the right choices. The only local state is a custom range being typed —
  // keyed to the value it started from, so it is dropped when that changes.
  const [draft, setDraft] = useState<{ for: string; from: string; to: string } | null>(null);
  const editing = draft?.for === value ? draft : null;
  const mode: Mode = editing ? "custom" : isAll ? ALL_TIME : (period.calendar ?? "custom");
  const from = editing?.from ?? period.start;
  const to = editing?.to ?? period.end;
  const setFrom = (next: string) => setDraft({ for: value, from: next, to });
  const setTo = (next: string) => setDraft({ for: value, from, to: next });

  function choose(code: string) {
    if (onChange) {
      onChange(code);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, code);
    // Superseded by period: the fiscal-year and month parameters from before #22.
    params.delete("fy");
    params.delete("month");
    router.push(`${pathname}?${params.toString()}`);
  }

  function changeMode(next: Mode) {
    if (next === ALL_TIME) return choose(ALL_TIME);
    if (next === "custom") {
      setDraft({ for: value, from: period.start, to: period.end });
      return;
    }
    setDraft(null);
    // Keep the moment in view: the year of the new kind that holds the start
    // of what was on screen.
    choose(periodCode(next, yearContaining(next, period.start)));
  }

  const calendar: CalendarKind = mode === "hijri" || mode === "au" || mode === "cy" ? mode : "hijri";
  const years = yearsToOffer(calendar, earliest, today);
  const selectedYear = period.calendar === calendar && period.year !== null ? period.year : years[0];
  const parts = partsOfYear(calendar, selectedYear);

  const shortcuts: { label: string; code: string }[] = [
    { label: "So far this year", code: `${calendar === "hijri" ? "h" : calendar}-ytd` },
    ...(isAll ? [] : [{ label: "Previous", code: previousPeriod(period, today).code }]),
    { label: "Last 12 months", code: "last12" },
  ];

  const selectClass = "input py-1.5 text-sm";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/55">Period</span>
          <select value={mode} onChange={(e) => changeMode(e.target.value as Mode)} className={`${selectClass} max-w-[13rem]`}>
            {(Object.keys(CALENDAR_LABELS) as CalendarKind[]).map((k) => (
              <option key={k} value={k}>
                {CALENDAR_LABELS[k]}
              </option>
            ))}
            <option value="custom">Custom range</option>
            {allowAllTime && <option value={ALL_TIME}>All time</option>}
          </select>
        </label>

        {mode !== "custom" && mode !== ALL_TIME && (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="sr-only">Year</span>
              <select
                value={selectedYear}
                onChange={(e) =>
                  choose(periodCode(calendar, Number(e.target.value), period.calendar === calendar ? period.part : { type: "year" }))
                }
                className={`${selectClass} max-w-[10rem]`}
                aria-label="Year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {yearLabel(calendar, y)}
                    {y === yearContaining(calendar, today) ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="sr-only">Part of the year</span>
              <select
                value={period.calendar === calendar ? partKey(period.part) : "year"}
                onChange={(e) => choose(periodCode(calendar, selectedYear, partFromKey(e.target.value)))}
                className={`${selectClass} max-w-[12rem]`}
                aria-label="Part of the year"
              >
                <option value="year">Whole year</option>
                <optgroup label="Quarters">
                  {parts
                    .filter((p) => p.part.type === "quarter")
                    .map((p) => (
                      <option key={partKey(p.part)} value={partKey(p.part)}>
                        {p.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Months">
                  {parts
                    .filter((p) => p.part.type === "month")
                    .map((p) => (
                      <option key={partKey(p.part)} value={partKey(p.part)}>
                        {p.label}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
          </>
        )}

        {mode === "custom" && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to && from <= to) {
                setDraft(null);
                choose(rangeCode(from, to));
              }
            }}
          >
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">From</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">To</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={selectClass} />
            </label>
            <button
              type="submit"
              disabled={!from || !to || from > to}
              className="rounded-md border border-ink/15 px-3 py-1.5 text-sm text-ink/75 hover:border-ink/30 disabled:opacity-50"
            >
              Show
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/50">
        {!isAll && (
          <span>
            {formatRange(period.start, period.end)}
            <span className="text-ink/35"> · </span>
            {formatRangeHijri(period.start, period.end)}
          </span>
        )}
        <span className="flex flex-wrap gap-x-2">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setDraft(null);
                choose(s.code);
              }}
              className="underline decoration-ink/25 underline-offset-2 hover:text-ink"
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
