import { MEASURES, type Measure } from "@/lib/reporting/measures";

/**
 * The line under a report's title: which expenses it counts and by which
 * date, and — folded behind it — what the money words on the page mean. The
 * wording is measures.ts's, so it is the same on every report and is what
 * the figures are actually counted by.
 *
 * One line, not three: the basis and the way to its definitions read as a
 * single sentence, and the page's first figure is not pushed down by them.
 */
export function MeasureKey({ measures, basis }: { measures: Measure[]; basis?: string }) {
  if (measures.length === 0) return basis ? <p className="mt-1 text-support text-ink/70">{basis}</p> : null;
  return (
    <details className="group mt-1 max-w-3xl text-support text-ink/70">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {basis && <>{basis} · </>}
        <span className="text-brand underline underline-offset-[3px] group-open:no-underline">How these figures are counted</span>
      </summary>
      <dl className="mt-2 flex flex-col gap-1.5 rounded-lg border border-ink/10 bg-white px-3.5 py-3">
        {measures.map((m) => {
          const { label, plain, meaning } = MEASURES[m];
          return (
            <div key={m}>
              <dt className="inline font-semibold text-ink">
                {label}
                {plain !== label && <span className="font-normal text-ink/70"> ({plain.toLowerCase()})</span>}
              </dt>{" "}
              <dd className="inline">— {meaning}</dd>
            </div>
          );
        })}
        <div>
          <dd>Declined and withdrawn expenses are never counted.</dd>
        </div>
      </dl>
    </details>
  );
}
