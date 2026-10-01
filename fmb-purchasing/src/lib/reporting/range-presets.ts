/**
 * The date ranges the Reports dashboard offers at a tap. Pure.
 *
 * A preset is kept in the address by its name — `range=this-month` — not by
 * its dates, so a bookmark made in October opens on November in November.
 * "Custom" hands over to the period picker, whose own code (`period=`) then
 * names the dates exactly.
 *
 * FMB keeps two years: its own, the Hijri year (Shawwal to Ramadan), which
 * budgets run on, and the Australian financial year (July to June), which the
 * GST return runs on. Both have a preset, named so neither is mistaken for
 * the other. Months and the quarter are calendar ones — the quarter being the
 * financial year's, which is also the BAS quarter.
 */

import { parsePeriod, periodCode, yearContaining, type Period } from "@/lib/periods";

export type RangePreset = "this-month" | "last-month" | "quarter" | "fy" | "hijri" | "custom";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "Financial year to date" },
  { key: "hijri", label: "Hijri year to date" },
  { key: "custom", label: "Custom" },
];

/** What the dashboard opens on: FMB's own year so far, as Reports and Budgets do. */
export const DEFAULT_PRESET: Exclude<RangePreset, "custom"> = "hijri";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The period code a preset means today. Custom has none of its own. */
export function presetCode(preset: Exclude<RangePreset, "custom">, today: string): string {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "this-month":
      return periodCode("cy", y, { type: "month", month: m });
    case "last-month":
      return m === 1 ? periodCode("cy", y - 1, { type: "month", month: 12 }) : periodCode("cy", y, { type: "month", month: m - 1 });
    case "quarter": {
      // The financial year starts in July, so July–September is its first quarter.
      const monthOfYear = ((m - 7 + 12) % 12) + 1;
      const quarter = (Math.floor((monthOfYear - 1) / 3) + 1) as 1 | 2 | 3 | 4;
      return periodCode("au", yearContaining("au", today), { type: "quarter", quarter });
    }
    case "fy":
      return "au-ytd";
    case "hijri":
      return "h-ytd";
  }
}

/**
 * The range a dashboard address asks for. `range` names a preset; `period`
 * with no `range` (or with `range=custom`) is a custom period; neither is the
 * default. Anything unreadable is the default too.
 */
export function resolveRange(params: Params, today: string): { preset: RangePreset; period: Period } {
  const asked = one(params.range);
  const custom = one(params.period);
  const preset: RangePreset = RANGE_PRESETS.some((p) => p.key === asked)
    ? (asked as RangePreset)
    : custom
      ? "custom"
      : DEFAULT_PRESET;

  if (preset === "custom") {
    // Custom with no period yet: start from the default's dates, to be changed.
    return { preset, period: parsePeriod(custom ?? presetCode(DEFAULT_PRESET, today), today) };
  }
  return { preset, period: parsePeriod(presetCode(preset, today), today) };
}
