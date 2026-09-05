/**
 * The shape of a page, while its data is still crossing the Pacific.
 *
 * Every route in this app is dynamic and database-backed, and nav links set
 * `prefetch={false}` deliberately, so a tap always waits on a real server
 * render before anything changes. The 2px hairline at the top of the viewport
 * was the only feedback that anything was happening — enough to know the tap
 * registered, not enough to stop the page feeling stalled.
 *
 * These are deliberately dull. A skeleton that shimmers or pulses draws the eye
 * to the loading rather than the content, and on a page that usually resolves
 * in under a second that is worse than a still frame. They match the real
 * layout closely enough that nothing jumps when the data lands, which is the
 * whole job.
 */

function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-ink/10 ${className}`} aria-hidden="true" />;
}

/** Page heading plus standfirst — every page in the app opens with these. */
export function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Bar className="h-7 w-56" />
      <Bar className="h-4 w-80 max-w-full" />
    </div>
  );
}

/**
 * A table page: toolbar, header row, and enough body rows to fill the fold.
 * `rows` is set per route to roughly what that page usually shows, so the
 * skeleton is the same height as what replaces it.
 */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div
      className="flex flex-col gap-6"
      // One announcement for the whole page, rather than a screen reader
      // walking a hundred meaningless placeholder cells.
      role="status"
      aria-label="Loading"
    >
      <HeaderSkeleton />
      <div className="flex flex-wrap items-center gap-3">
        <Bar className="h-9 w-64 max-w-full" />
        <Bar className="h-9 w-28" />
      </div>
      <div className="overflow-hidden rounded-lg border border-ink/10">
        <div className="flex gap-4 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5">
          {Array.from({ length: columns }, (_, i) => (
            <Bar key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 border-b border-ink/5 px-4 py-3 last:border-b-0">
            {Array.from({ length: columns }, (_, c) => (
              <Bar key={c} className="h-3.5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A page of cards — the dashboard, and the reports overview. */
export function CardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading">
      <HeaderSkeleton />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-white/60 p-4">
            <Bar className="h-3.5 w-32" />
            <Bar className="h-8 w-40" />
            <Bar className="h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A form page — Submit, and the expense detail view. */
export function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading">
      <HeaderSkeleton />
      <div className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white/60 p-6">
        <Bar className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Bar className="h-3 w-24" />
              <Bar className="h-9 w-full" />
            </div>
          ))}
        </div>
        <Bar className="h-32 w-full" />
      </div>
    </div>
  );
}
