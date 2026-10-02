"use client";

import { useEffect, useRef, useState } from "react";
import { formatRange, parsePeriod } from "@/lib/periods";
import { PeriodPicker } from "./period-picker";

/**
 * The period of a report as one control in its filter row: the period by
 * name with its dates, and the whole picker (period-picker) behind it.
 *
 * The picker laid out in full — three lists, the dates in two calendars and
 * three shortcuts — is as wide as every other filter put together, and it
 * was always open. A report is read far more often than its period is
 * changed, so the row shows what the period is and opens the picker when it
 * is asked for.
 */
export function PeriodMenu({
  value,
  today,
  earliest,
  onChange,
}: {
  value: string;
  /** Today in Sydney, from the server — never the viewer's own clock. */
  today: string;
  earliest: string | null;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const period = parsePeriod(value, today);
  const dates = formatRange(period.start, period.end);

  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1 text-support">
      <span className="font-medium text-ink/70">Period</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="input flex max-w-full min-w-[11rem] items-center justify-between gap-3 text-left text-body"
      >
        <span className="min-w-0 truncate">
          {period.label}
          {/* A range of one's own dates is already named by them. */}
          {period.label !== dates && <span className="text-ink/60"> · {dates}</span>}
        </span>
        <span aria-hidden="true" className="shrink-0 text-ink/40">
          ▾
        </span>
      </button>

      {open && (
        // Stays open while a year and then a part of it are chosen: each
        // choice redraws the report behind, and the picker is closed by
        // pressing anywhere else.
        <div
          role="group"
          aria-label="Choose a period"
          className="absolute top-full left-0 z-30 mt-1 w-max max-w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-ink/15 bg-white p-3 shadow-lg"
        >
          <PeriodPicker value={value} today={today} earliest={earliest} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
