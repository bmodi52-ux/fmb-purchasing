import Link from "next/link";

/** One tab of a page split into sections that each have their own address. */
export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="tab"
    >
      {children}
    </Link>
  );
}
