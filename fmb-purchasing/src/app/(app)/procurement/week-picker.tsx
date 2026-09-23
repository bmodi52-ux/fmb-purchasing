import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { formatPlainDate } from "@/lib/format";
import { isWholeWeek, shiftWeeks, weekLabel, weekOf, type DateRange } from "@/lib/buying-week";

/**
 * The week being bought for, on both procurement pages (#73).
 *
 * Buying is weekly, so the page opens on this week rather than on two empty
 * date boxes, and the arrows step a week at a time — which is how a butcher's
 * order is actually thought about. The boxes are still there underneath for a
 * range that is not a week, and the arrows then step from wherever it starts.
 */
export function WeekPicker({
  action,
  range,
  today,
  hidden = {},
}: {
  /** The page this belongs to, which is where the form submits. */
  action: string;
  range: DateRange;
  today: string;
  /** Anything else in the query string that should survive a week change. */
  hidden?: Record<string, string | undefined>;
}) {
  const href = (next: DateRange) => {
    const params = new URLSearchParams({ from: next.from, to: next.to });
    for (const [key, value] of Object.entries(hidden)) if (value) params.set(key, value);
    return `${action}?${params.toString()}`;
  };

  const step = "rounded-md border border-ink/15 px-3 py-2 text-ink/70 hover:border-ink/30";

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <Link href={href(shiftWeeks(range, -1))} aria-label="The week before" className={step}>
          ←
        </Link>
        <span className="min-w-52 text-center">
          <span className="block text-ink">{weekLabel(range, today)}</span>
          <span className="block text-xs text-ink/50">
            {formatPlainDate(range.from)} – {formatPlainDate(range.to)}
          </span>
        </span>
        <Link href={href(shiftWeeks(range, 1))} aria-label="The week after" className={step}>
          →
        </Link>
        {!isWholeWeek(range) && (
          <Link href={href(weekOf(today))} className="text-xs text-ink/55 underline-offset-2 hover:underline">
            Back to this week
          </Link>
        )}
      </div>

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink/60">From</span>
          <input type="date" name="from" defaultValue={range.from} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink/60">To</span>
          <input type="date" name="to" defaultValue={range.to} className="input py-1.5" />
        </label>
        {Object.entries(hidden).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} /> : null
        )}
        <SubmitButton className="btn btn-secondary btn-sm">Show</SubmitButton>
      </form>
    </div>
  );
}
