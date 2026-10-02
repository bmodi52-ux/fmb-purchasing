/**
 * The scale a chart is drawn against, and how its figures are shortened.
 * Pure, so the lines on a chart can be tested without drawing one.
 */

/** Steps a person would rule a chart in: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 of something. */
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/**
 * The top of a chart's scale and the lines under it, for a largest value.
 * The lines are evenly spaced round figures, and the top is the first that
 * holds the largest value — so the tallest column reaches most of the way up
 * and every line can be labelled with a number worth reading.
 */
export function niceScale(max: number, lines = 3): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: lines, ticks: Array.from({ length: lines + 1 }, (_, i) => i) };
  const magnitude = 10 ** Math.floor(Math.log10(max / lines));
  let step = STEPS[STEPS.length - 1] * magnitude * 10;
  for (const scale of [magnitude, magnitude * 10]) {
    const found = STEPS.find((s) => s * scale * lines >= max);
    if (found !== undefined) {
      step = found * scale;
      break;
    }
  }
  // 0.1 + 0.2 and its relatives: a step of 0.3 three times is 0.8999….
  const round = (n: number) => Number(n.toPrecision(12));
  return { top: round(step * lines), ticks: Array.from({ length: lines + 1 }, (_, i) => round(step * i)) };
}

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/**
 * An amount short enough for an axis or the top of a column: "$45k",
 * "$1.5k", "$820", "$1.2M". Whole where it is whole — "$27k", not "$27.0k".
 */
export function shortMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 999_950) return `${sign}$${trim(abs / 1_000_000, 1)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000, 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** An amount to the dollar, for a ranking or a legend: "$26,962". Cents are in the tables. */
export function wholeMoney(n: number): string {
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

/**
 * A share as a whole percentage: "32%". Under one per cent, but not nothing,
 * is "<1%" rather than a "0%" that says it wasn't there.
 */
export function sharePercent(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return "";
  const share = (part / whole) * 100;
  return share < 0.5 ? "<1%" : `${Math.round(share)}%`;
}

/**
 * "Meat & Poultry › Chicken" and "Chicken · Meat & Poultry" both as
 * ["Chicken", "Meat & Poultry"]: the name that tells one row from the next,
 * then the heading it sits under. A chart shows the first plainly and the
 * second quietly, the same way wherever the name came from.
 */
export function splitName(label: string): [string, string | null] {
  const path = label.split(" › ");
  if (path.length === 2) return [path[1], path[0]];
  const at = label.indexOf(" · ");
  return at > 0 ? [label.slice(0, at), label.slice(at + 3)] : [label, null];
}

/** Which of n labels along an axis to print so that about `room` of them show, evenly spaced. */
export function labelEvery(n: number, room = 12): number {
  return n <= room ? 1 : Math.ceil(n / room);
}
