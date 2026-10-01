import Link from "next/link";
import type { FilterOption } from "@/lib/reporting/aggregate";
import { SECTIONS, buildHref, type ReportQuery, type ReportSection } from "@/lib/reporting/query";

export type { FilterOption };

export function SectionTabs({ query, active }: { query: ReportQuery; active: ReportSection }) {
  return (
    <nav aria-label="Report sections" className="tabs border-b-0">
      {SECTIONS.map((s) => {
        const isActive = s.key === active;
        return (
          <Link
            key={s.key}
            href={buildHref(query, { section: s.key })}
            aria-current={isActive ? "page" : undefined}
            className="tab"
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
