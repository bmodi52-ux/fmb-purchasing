import Link from "next/link";

export type ReportArea = "spend" | "money-out" | "exceptions";

/**
 * Which report you are in, above every report page: what was spent, what has
 * gone out, and what needs checking — and, for those who can see them, the
 * budgets and the GST figures, which live on their own pages.
 */
export function ReportNav({
  active,
  canBudgets,
  canGst,
}: {
  active: ReportArea;
  canBudgets: boolean;
  canGst: boolean;
}) {
  const links: { href: string; label: string; area?: ReportArea }[] = [
    { href: "/reports", label: "Spending", area: "spend" },
    { href: "/reports/money-out", label: "Money out", area: "money-out" },
    { href: "/reports/exceptions", label: "Exceptions", area: "exceptions" },
    ...(canBudgets ? [{ href: "/budgets", label: "Budgets" }] : []),
    ...(canGst ? [{ href: "/accounting", label: "GST" }] : []),
  ];
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-1.5">
      {links.map((l) => {
        const current = l.area === active;
        return (
          <Link
            key={l.href}
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
