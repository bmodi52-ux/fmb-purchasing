"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

const MONTHS = "January February March April May June July August September October November December".split(" ");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function label(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Pick any number of days, across months (#20). Each picked day is posted as
 * a `dates` field. Days that already have a menu are marked, so the question
 * of what to do with them is asked with them in view.
 */
export function DayPicker({
  today,
  planned,
  maxDays,
}: {
  today: string;
  /** Dates that already have a menu in some kitchen, with which. */
  planned: Record<string, string[]>;
  maxDays: number;
}) {
  const [year0, month0] = today.split("-").map(Number);
  const [view, setView] = useState({ y: year0, m: month0 - 1 });
  const [picked, setPicked] = useState<string[]>([]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[];
  }, [view]);

  const move = (delta: number) =>
    setView(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const toggle = (date: string) =>
    setPicked((p) =>
      p.includes(date) ? p.filter((d) => d !== date) : p.length >= maxDays ? p : [...p, date].sort()
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="w-full max-w-sm rounded-md border border-ink/10 bg-white p-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => move(-1)}
            className="rounded px-2 py-1 text-ink/60 hover:bg-ink/5"
            aria-label="Previous month"
          >
            ←
          </button>
          <span className="font-medium text-ink">
            {MONTHS[view.m]} {view.y}
          </span>
          <button
            type="button"
            onClick={() => move(1)}
            className="rounded px-2 py-1 text-ink/60 hover:bg-ink/5"
            aria-label="Next month"
          >
            →
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEKDAYS.map((d) => (
            <span key={d} className="pb-1 text-ink/45">
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day == null) return <span key={`blank-${i}`} />;
            const date = iso(view.y, view.m, day);
            const on = picked.includes(date);
            const has = planned[date];
            const past = date < today;
            return (
              <button
                key={date}
                type="button"
                onClick={() => toggle(date)}
                aria-pressed={on}
                aria-label={`${label(date)}${has ? `, already has a menu in ${has.join(" and ")}` : ""}`}
                title={has ? `Already has a menu: ${has.join(", ")}` : undefined}
                className={`relative rounded py-1.5 text-sm transition-colors ${
                  on
                    ? "bg-gold font-medium text-ink"
                    : past
                      ? "text-ink/30 hover:bg-ink/5"
                      : "text-ink hover:bg-gold/15"
                } ${date === today && !on ? "ring-1 ring-gold-deep" : ""}`}
              >
                {day}
                {has && (
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                      on ? "bg-ink/60" : "bg-maroon/60"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/50">
          <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-maroon/60" /> already has a menu
        </p>
      </div>

      <div className="text-sm">
        {picked.length === 0 ? (
          <p className="text-ink/50">No days picked yet. Click days on the calendar to pick them.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink/60">
              {picked.length} {picked.length === 1 ? "day" : "days"}:
            </span>
            {picked.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => toggle(date)}
                className="rounded-full border border-ink/15 bg-white px-2.5 py-0.5 text-xs text-ink hover:border-maroon/40"
                aria-label={`Unpick ${label(date)}`}
              >
                {label(date)} ✕
              </button>
            ))}
            {picked.length >= maxDays && (
              <span className="text-xs text-alert">That&apos;s the most at once ({maxDays}).</span>
            )}
          </div>
        )}
        {picked.map((date) => (
          <input key={date} type="hidden" name="dates" value={date} />
        ))}
      </div>

      <SubmitButton
        disabled={picked.length === 0}
        pendingLabel="Putting it on…"
        className="btn btn-primary self-start"
      >
        {picked.length === 0 ? "Pick days first" : `Put on ${picked.length} ${picked.length === 1 ? "day" : "days"}`}
      </SubmitButton>
    </div>
  );
}
