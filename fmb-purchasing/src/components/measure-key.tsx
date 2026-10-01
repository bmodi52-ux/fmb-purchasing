import { MEASURES, type Measure } from "@/lib/reporting/measures";

/**
 * What the money words on a report mean, folded away under its title. The
 * wording is measures.ts's, so it is the same on every report and is what
 * the figures are actually counted by.
 */
export function MeasureKey({ measures }: { measures: Measure[] }) {
  if (measures.length === 0) return null;
  return (
    <details className="mt-1.5 max-w-2xl text-xs text-ink/65">
      <summary className="cursor-pointer text-ink/55 underline-offset-2 hover:text-ink hover:underline">
        How these figures are counted
      </summary>
      <dl className="mt-2 flex flex-col gap-1.5">
        {measures.map((m) => {
          const { label, plain, meaning } = MEASURES[m];
          return (
            <div key={m}>
              <dt className="inline font-medium text-ink">
                {label}
                {plain !== label && <span className="font-normal text-ink/55"> ({plain.toLowerCase()})</span>}
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
