import type { CurrentUser } from "@/lib/auth/session";
import { favouriteReportsOf } from "@/lib/reporting/favourites-data";
import { findReport } from "@/lib/reporting/registry";
import { FavouriteStar } from "./favourite-star";
import { MeasureKey } from "@/components/measure-key";
import { ReportNav } from "./report-nav";

/**
 * The top of every report page, in one shape: the row of reports, then the
 * report's name with its star on the left and what can be done with it
 * (download, saved views) on the right, and under the name one line saying
 * which expenses it counts and by which date, with the key to its words
 * folded behind it.
 *
 * The name and measures are the registry's (lib/reporting/registry), so a
 * report is described in one place. What a report is for is said where
 * reports are chosen — the dashboard's list — not again above its figures.
 */
export async function ReportHeader({
  report,
  user,
  basis,
  description,
  title,
  actions,
}: {
  /** The report's registry key. */
  report: string;
  user: CurrentUser;
  /** "By receipt date · approved and paid" — left out where a report has no single basis. */
  basis?: string;
  /** Something a reader needs before the figures: where else to look, what a filter is doing. */
  description?: React.ReactNode;
  /** Instead of the registry's, for a page that holds more than the report. */
  title?: string;
  /** Buttons for the report as a whole, set against the right edge. */
  actions?: React.ReactNode;
}) {
  const definition = findReport(report)!;
  const favourite = (await favouriteReportsOf(user.id)).includes(report);
  return (
    <>
      <ReportNav active={report} user={user} />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="page-title">{title ?? definition.title}</h1>
            {/* A star keeps the report on the dashboard's list of favourites (0088). */}
            <FavouriteStar reportKey={report} title={definition.nav?.label ?? definition.title} initial={favourite} />
          </div>
          <MeasureKey measures={definition.measures} basis={basis} />
          {description && <p className="mt-1.5 max-w-3xl text-support text-ink/70">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </>
  );
}
