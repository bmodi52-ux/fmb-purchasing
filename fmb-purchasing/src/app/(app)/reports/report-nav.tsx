import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { reportNavFor } from "@/lib/reporting/registry";

/**
 * Which report you are in, above every report page. The links are the
 * registry's (lib/reporting/registry): a report given a place in the row
 * there appears here, for everyone who may open it.
 */
export async function ReportNav({ active, user }: { active: string; user: CurrentUser }) {
  const links = await reportNavFor(user);
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-1.5">
      {links.map((l) => {
        const current = l.key === active;
        return (
          <Link
            key={l.key}
            href={l.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              current
                ? "bg-gold/25 text-ink ring-1 ring-gold/50"
                : "border border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
