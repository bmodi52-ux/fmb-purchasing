import type { CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFavouriteReports } from "@/lib/reporting/favourites";
import { findReport } from "@/lib/reporting/registry";
import { FavouriteStar } from "./favourite-star";
import { MeasureKey } from "@/components/measure-key";
import { ReportNav } from "./report-nav";

/**
 * The top of every report page, in one shape: the row of links between
 * reports, the report's name and what it is for, the line saying which
 * expenses it counts and by which date, and the key to the words it uses.
 *
 * The name, description and measures are the registry's
 * (lib/reporting/registry), so a report is described in one place.
 */
export async function ReportHeader({
  report,
  user,
  basis,
  description,
  title,
}: {
  /** The report's registry key. */
  report: string;
  user: CurrentUser;
  /** "By receipt date · approved and paid" — left out where a report has no single basis. */
  basis?: string;
  /** Instead of the registry's, for a page that says more. */
  description?: React.ReactNode;
  /** Instead of the registry's, for a page that holds more than the report. */
  title?: string;
}) {
  const definition = findReport(report)!;
  const favourite = (await loadFavouriteReports(createAdminClient(), user.id)).includes(report);
  return (
    <>
      <ReportNav active={report} user={user} />
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="page-title text-ink">{title ?? definition.title}</h1>
          {/* A star keeps the report on the dashboard's list of favourites (0088). */}
          <FavouriteStar reportKey={report} title={definition.nav?.label ?? definition.title} initial={favourite} />
        </div>
        <p className="page-description mt-1 max-w-2xl">{description ?? definition.description}</p>
        {basis && <p className="mt-1 text-xs text-ink/55">{basis}</p>}
        <MeasureKey measures={definition.measures} />
      </div>
    </>
  );
}
