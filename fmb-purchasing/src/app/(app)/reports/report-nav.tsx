import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { favouriteReportsOf } from "@/lib/reporting/favourites-data";
import { reportNavFor } from "@/lib/reporting/registry";

/**
 * Which report you are in, above every report page. The links are the
 * registry's (lib/reporting/registry): a report given a place in the row
 * there appears here, for everyone who may open it.
 *
 * Tabs, in an order that does not move: the reports someone has starred are
 * marked where they stand rather than brought to the front, so a tab is
 * always where it was yesterday.
 */
export async function ReportNav({ active, user }: { active: string; user: CurrentUser }) {
  const [links, favourites] = await Promise.all([reportNavFor(user), favouriteReportsOf(user.id)]);
  return (
    <nav aria-label="Reports" className="tabs tabs-report">
      {links.map((l) => (
        <Link key={l.key} href={l.href} aria-current={l.key === active ? "page" : undefined} className="tab">
          {l.label}
          {favourites.includes(l.key) && (
            <span className="ml-1.5 text-[0.7rem] text-gold-deep" title="One of your favourites">
              <span aria-hidden="true">★</span>
              <span className="sr-only"> (favourite)</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
