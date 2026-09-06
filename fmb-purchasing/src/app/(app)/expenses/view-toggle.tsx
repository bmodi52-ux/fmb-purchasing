"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Expenses, or the lines inside them.
 *
 * A link rather than client state, so a particular view of a particular year
 * is a URL somebody can send to the Treasurer. The fiscal year is carried
 * across because the two views are the same period seen at two depths, and
 * switching depth should never quietly change the period.
 */
export function ViewToggle({ linesView }: { linesView: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function href(view: "expenses" | "lines") {
    const next = new URLSearchParams(params);
    if (view === "lines") next.set("view", "lines");
    else next.delete("view");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div
      className="inline-flex rounded-md border border-ink/15 p-0.5 text-xs"
      role="group"
      aria-label="View"
    >
      <Tab href={href("expenses")} active={!linesView} label="Expenses" />
      <Tab href={href("lines")} active={linesView} label="Line items" />
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "true" : undefined}
      className={`rounded px-3 py-1 ${
        active ? "bg-gold/20 font-medium text-ink" : "text-ink/60 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
