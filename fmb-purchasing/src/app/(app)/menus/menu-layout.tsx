import type { MenuDayCost } from "@/lib/menu-costing";

/**
 * How a menu page is laid out, on a day or saved apart from one (#24).
 *
 * The builder on the left; on the right, what it comes to and what to do with
 * it, held in view while the dishes are added. It used to be seven identical
 * panels in a column with the answer — what a thaali costs — at the bottom,
 * below the fold. On a phone the right column drops under the builder and a
 * bar along the bottom keeps the figure in sight.
 */

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export function MenuLayout({
  main,
  aside,
  cost,
  barAction,
}: {
  main: React.ReactNode;
  aside: React.ReactNode;
  cost: MenuDayCost;
  /** The one thing to do next, carried on the phone's bottom bar. */
  barAction?: { href: string; label: string };
}) {
  const hasCost = cost.lines.length > 0;
  return (
    <>
      <div
        className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:pb-0 xl:grid-cols-[minmax(0,1fr)_22rem] ${
          hasCost ? "pb-24" : ""
        }`}
      >
        <div className="flex min-w-0 flex-col gap-6">{main}</div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">{aside}</aside>
      </div>

      {hasCost && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-ink/10 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-lg leading-tight font-semibold tabular-nums text-ink">
              {money(cost.perThaali ?? cost.total)}
              <span className="ml-1 text-sm font-normal text-ink/55">{cost.perThaali != null ? "a thaali" : "in all"}</span>
            </p>
            {cost.perThaali != null && <p className="text-xs tabular-nums text-ink/55">{money(cost.total)} in all</p>}
          </div>
          {barAction && (
            <a href={barAction.href} className="btn btn-primary">
              {barAction.label}
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** The figure a menu is built to find out, then what to do with it. */
export function MenuSummary({
  cost,
  thaalis,
  emptyHint,
  children,
}: {
  cost: MenuDayCost;
  thaalis: number;
  /** Said in place of the figures before there are any. */
  emptyHint: string;
  /** The actions for this menu. */
  children?: React.ReactNode;
}) {
  const hasCost = cost.lines.length > 0;
  return (
    <section aria-label="Estimate" className="card p-5">
      <p className="text-xs font-medium tracking-wide text-ink/50 uppercase">Estimate</p>
      {hasCost ? (
        <>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-ink">
            {money(cost.perThaali ?? cost.total)}
          </p>
          <p className="text-sm text-ink/60">{cost.perThaali != null ? "a thaali" : "in all, with no thaali count"}</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ink/10 pt-3 text-sm">
            <div>
              <dt className="text-xs text-ink/50">Total</dt>
              <dd className="tabular-nums text-ink">{money(cost.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/50">Thaalis</dt>
              <dd className="tabular-nums text-ink">{thaalis}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/50">Items</dt>
              <dd className="tabular-nums text-ink">{cost.lines.length}</dd>
            </div>
          </dl>
          {cost.unpriced > 0 && (
            <p className="mt-3 text-xs text-alert">
              {cost.unpriced} {cost.unpriced === 1 ? "item has" : "items have"} no price, so the real cost is higher.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-ink/55">{emptyHint}</p>
      )}
      {children && <div className="mt-5 flex flex-col gap-4 border-t border-ink/10 pt-4">{children}</div>}
    </section>
  );
}
