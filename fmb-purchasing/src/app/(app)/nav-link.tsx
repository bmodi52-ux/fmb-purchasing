"use client";

import { useEffect } from "react";
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
 *
 * The pending signal is reported upward rather than drawn here, because on
 * mobile the tap also closes the menu: the surrounding <aside> gets
 * display:none, and a display:none ancestor stops its whole subtree from
 * rendering — a position:fixed progress bar included. The bar therefore has
 * to live outside the collapsible menu, so only the signal travels up.
 */
export function NavLink({
  href,
  label,
  onNavigate,
  onPendingChange,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
  onPendingChange?: (href: string, pending: boolean) => void;
}) {
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
      <PendingIndicator href={href} onPendingChange={onPendingChange} />
    </Link>
  );
}

/** Must be a descendant of the Link for useLinkStatus to see it. */
function PendingIndicator({
  href,
  onPendingChange,
}: {
  href: string;
  onPendingChange?: (href: string, pending: boolean) => void;
}) {
  const { pending } = useLinkStatus();

  useEffect(() => {
    onPendingChange?.(href, pending);
  }, [pending, href, onPendingChange]);

  return (
    <>
      <span aria-hidden className="nav-spinner" data-pending={pending || undefined} />
      {pending && (
        <span role="status" aria-live="polite" className="sr-only">
          Loading
        </span>
      )}
    </>
  );
}
