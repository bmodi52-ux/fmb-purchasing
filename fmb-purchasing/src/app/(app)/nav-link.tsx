"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useReportPending } from "@/components/pending";

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
  badge,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
  /** Unread count; hidden when zero. */
  badge?: number;
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
      <span className="flex items-center gap-2">
        {badge != null && badge > 0 && (
          <span
            className="rounded-full bg-gold-deep px-1.5 py-0.5 text-[0.65rem] font-medium leading-none text-cream"
            aria-label={`${badge} unread`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        <PendingIndicator />
      </span>
    </Link>
  );
}

/** Must be a descendant of the Link for useLinkStatus to see it. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  // Reported to the shared provider, which draws the bar outside the
  // collapsible menu — a display:none ancestor would stop it rendering.
  useReportPending(pending);

  return <span aria-hidden className="nav-spinner" data-pending={pending || undefined} />;
}
