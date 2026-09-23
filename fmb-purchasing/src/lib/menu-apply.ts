/**
 * Putting one menu on many days (#20): what happens on each day.
 *
 * Most picked days are empty and simply get the menu. The question is the
 * days that already have one, and the person says what to do with those:
 * leave them, add this menu to what is there, or replace it. The one thing
 * never done is replacing a day somebody has already bought for; that stays,
 * whatever was asked, as deleting a menu does (#21).
 */

export type ExistingDayChoice = "skip" | "add" | "replace";

export type TargetDay = {
  /** A menu_days row exists for this kitchen and date. */
  exists: boolean;
  /** It has dishes, roti or fruit, typed lines, or menu text. */
  hasContent: boolean;
  released: boolean;
  /** Something on it has been ordered, delivered, or had a receipt allocated. */
  bought: boolean;
};

export type DayOutcome =
  /** Empty or new: the menu goes on as it is. */
  | "fill"
  /** Has a menu, and this one is added alongside it. */
  | "add"
  /** Has a menu, which is cleared first. */
  | "replace"
  /** Has a menu, and the person said to leave those. */
  | "skip_has_menu"
  /** Replacing was asked, but somebody has already bought for it. */
  | "skip_bought";

export function outcomeFor(day: TargetDay, choice: ExistingDayChoice): DayOutcome {
  if (!day.exists || !day.hasContent) return "fill";
  if (choice === "skip") return "skip_has_menu";
  if (choice === "add") return "add";
  return day.bought ? "skip_bought" : "replace";
}

/**
 * A released day whose menu changes is back to a plan: its lists were worked
 * out from the old menu. Releasing it again recomputes them.
 */
export function needsUnrelease(day: TargetDay, outcome: DayOutcome): boolean {
  return day.released && (outcome === "add" || outcome === "replace");
}

/** Only real calendar dates, each once, in order. */
export function cleanDates(raw: readonly string[]): string[] {
  const valid = raw.filter((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
  });
  return [...new Set(valid)].sort();
}

export type ApplySummary = Record<DayOutcome, number> & { unreleased: number };

export function emptySummary(): ApplySummary {
  return { fill: 0, add: 0, replace: 0, skip_has_menu: 0, skip_bought: 0, unreleased: 0 };
}

/** One sentence for the page to show after the menu has gone on. */
export function describeSummary(s: ApplySummary): string {
  const put = s.fill + s.add + s.replace;
  const parts = [`Put on ${put} ${put === 1 ? "day" : "days"}`];
  if (s.add > 0) parts.push(`added to the menu already on ${s.add}`);
  if (s.replace > 0) parts.push(`replaced the menu on ${s.replace}`);
  if (s.skip_has_menu > 0) {
    parts.push(`left ${s.skip_has_menu} that already had a menu`);
  }
  if (s.skip_bought > 0) {
    parts.push(`left ${s.skip_bought} that had already been bought for`);
  }
  let sentence = parts.join(", ") + ".";
  if (s.unreleased > 0) {
    sentence += ` ${s.unreleased} ${s.unreleased === 1 ? "was" : "were"} released and ${
      s.unreleased === 1 ? "is" : "are"
    } back to draft, to release again.`;
  }
  return sentence;
}
