import Link from "next/link";

/** One tab of a page split into sections that each have their own address. */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
        active ? "border-gold-deep font-medium text-ink" : "border-transparent text-ink/60 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
