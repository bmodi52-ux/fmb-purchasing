import Link from "next/link";

/**
 * A headline figure on a report: what it is, the figure, and a line or two
 * about it. One tile, so a figure is the same size on the dashboard, Money
 * out, Exceptions and GST — each page had its own, in three sizes.
 *
 * Red is for a figure that is itself the problem (overdue, over budget) and
 * nothing else; a change against last year is not good or bad, and is said
 * in words by whoever passes it in.
 */
export function ReportTile({
  label,
  value,
  hint,
  tone = "normal",
  dot,
  href,
  meter,
  children,
}: {
  label: string;
  value: string;
  /** One quiet line under the figure. For more than a line, pass children. */
  hint?: string;
  tone?: "normal" | "danger" | "muted";
  /** A mark before the label: something here needs acting on, or nothing does. */
  dot?: "alert" | "good";
  /** Makes the whole tile a link to the report the figure is from. */
  href?: string;
  /** How much of something is used up, as a bar under the figure. 1 is all of it. */
  meter?: number;
  children?: React.ReactNode;
}) {
  const figure = tone === "danger" ? "text-danger" : tone === "muted" ? "text-ink/60" : "text-ink";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-support font-medium text-ink/70">
        <span className="min-w-0">
          {dot && (
            <span
              aria-hidden="true"
              className={`mr-1.5 inline-block h-2 w-2 rounded-full align-[1px] ${dot === "alert" ? "bg-alert" : "bg-palm"}`}
            />
          )}
          {label}
        </span>
        {href && (
          <span aria-hidden="true" className="text-base leading-none text-ink/40 group-hover:text-ink">
            ›
          </span>
        )}
      </div>
      {/* Proportional figures, not tabular: at this size tabular digits make a number like 121 look gappy. */}
      <p className={`text-[clamp(1.6rem,1.3rem+1.1vw,2rem)] leading-[1.1] font-semibold tracking-tight ${figure}`}>{value}</p>
      {meter !== undefined && (
        <span
          role="img"
          aria-label={`${Math.round(meter * 100)}% used`}
          className="my-0.5 block h-2 overflow-hidden rounded-full bg-ink/[0.07]"
        >
          <span
            className={`block h-full rounded-full ${meter > 1 ? "bg-danger" : "bg-gold-deep"}`}
            style={{ width: `${Math.min(100, Math.max(0, Math.round(meter * 100)))}%` }}
          />
        </span>
      )}
      {(hint || children) && (
        <div className="flex flex-1 flex-col gap-0.5 text-support text-ink/70 [&_strong]:font-semibold [&_strong]:text-ink">
          {hint && <span>{hint}</span>}
          {children}
        </div>
      )}
    </>
  );

  const shape = "flex min-w-0 flex-col gap-1.5 card px-[1.1rem] py-4";
  return href ? (
    <Link
      href={href}
      className={`group ${shape} transition-colors hover:border-ink/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold`}
    >
      {body}
    </Link>
  ) : (
    <div className={shape}>{body}</div>
  );
}

/** A row of tiles: one column on a phone, two on a tablet, all in a row on a wide screen. */
export function ReportTiles({ count, children }: { count: 2 | 3 | 4; children: React.ReactNode }) {
  const wide = count === 4 ? "xl:grid-cols-4" : count === 3 ? "lg:grid-cols-3" : "";
  return <div className={`grid gap-3 sm:grid-cols-2 ${wide}`}>{children}</div>;
}
