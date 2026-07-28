"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar link with feedback for the wait between tap and page change.
 *
 * Nav links deliberately set prefetch={false} and every destination is a
 * dynamic, database-backed page, so there is a real gap before anything
 * visibly happens — on a phone that reads as the tap having been ignored.
 * useLinkStatus is documented as being for exactly this case (prefetch
 * disabled, dynamic destination, no loading.js).
 */
export function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  // "/" would otherwise prefix-match every route
  const isActive = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className="nav-link"
    >
      <span>{label}</span>
      <PendingIndicator />
    </Link>
  );
}

/** Must be a descendant of the Link for useLinkStatus to see it. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden className="nav-spinner" data-pending={pending || undefined} />
      {pending && (
        <>
          <span className="route-progress" aria-hidden />
          <span role="status" aria-live="polite" className="sr-only">
            Loading
          </span>
        </>
      )}
    </>
  );
}
