"use client";

import { SubmitButton } from "@/components/submit-button";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, type NavGroup } from "@/lib/nav";
import { NavLink } from "./nav-link";

type NavItem = { key: string; href: string; label: string; group: NavGroup };

export function AppSidebar({
  navItems,
  userName,
  signOutAction,
  unreadCount,
  canNameStandIn,
}: {
  navItems: NavItem[];
  userName: string;
  signOutAction: (formData: FormData) => void;
  unreadCount: number;
  /** Whether this person approves or pays, and so can hand that over while away (#35). */
  canNameStandIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const inAdmin = navItems.some((i) => i.group === "Admin" && (pathname === i.href || pathname.startsWith(`${i.href}/`)));

  return (
    // Pinned on a phone: the menu is the only way around the app there, and on
    // a long form it was a scroll all the way back up to reach it.
    <div className="sticky top-0 z-40 md:contents">

      {/* Mobile-only top bar: unaffected by md: below, invisible on desktop */}
      <div className="relative z-40 flex items-center justify-between border-b border-gold/20 bg-cream px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Image src="/fmb-logo.png" alt="FMB" width={34} height={34} className="rounded" />
          {/* Sized above body text so the header anchors the page rather than
              being dwarfed by the title beneath it. */}
          <span className="brand-wordmark text-[1.15rem] font-semibold leading-none text-ink">FMB Sydney</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationsBell count={unreadCount} onNavigate={() => setOpen(false)} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="rounded-md p-2 text-ink/70 hover:bg-gold/15"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
        </div>
      </div>

      {/* Backdrop: closes the menu on tap, mobile only, never renders at md:.
          Not a <button>. It was one, which put a second, invisible "Close menu"
          control into the tab order immediately after the real one — so a
          keyboard user met the same announcement twice with nothing between
          them. The toggle above already closes the menu and is reachable;
          this is a tap target for people using a finger. */}
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/30 md:hidden"
        />
      )}

      <aside
        className={`${open ? "absolute flex" : "hidden"} inset-x-0 top-full z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto shadow-lg w-full shrink-0 flex-col gap-6 border-b border-gold/20 bg-cream px-6 py-8 md:sticky md:top-0 md:flex md:z-auto md:h-screen md:max-h-none md:w-64 md:overflow-y-auto md:border-b-0 md:border-r md:bg-gradient-to-b md:from-gold/10 md:via-cream md:to-cream md:shadow-none`}
      >
        <div className="hidden items-start justify-between gap-2 md:flex">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/fmb-logo.png" alt="FMB" width={40} height={40} className="rounded" />
            <div>
              <p className="brand-wordmark text-lg font-semibold leading-tight text-ink">FMB Sydney</p>
              <p className="text-xs text-ink/60">Faiz ul Mawaid il Burhaniyah</p>
            </div>
          </Link>
          <NotificationsBell count={unreadCount} />
        </div>

        <div className="hidden md:block">
          <PalmDivider />
        </div>

        <nav className="flex flex-1 flex-col gap-4 text-sm">
          {NAV_GROUPS.map((group) => {
            const items = navItems.filter((i) => i.group === group);
            if (items.length === 0) return null;
            const links = items.map((item) => (
              // Keyed by href, not key: `key` is the permission page, and more
              // than one nav entry can sit behind the same grant.
              <NavLink key={item.href} href={item.href} label={item.label} onNavigate={() => setOpen(false)} />
            ));
            // Admin is visited rarely and by few, so it folds away unless
            // you are on one of its pages.
            if (group === "Admin") {
              return (
                <details key={group} open={inAdmin} className="group/admin">
                  <summary className="nav-group-label flex cursor-pointer list-none items-center justify-between">
                    {group}
                    <span aria-hidden="true" className="transition-transform group-open/admin:rotate-90">›</span>
                  </summary>
                  <div className="mt-1 flex flex-col gap-0.5">{links}</div>
                </details>
              );
            }
            return (
              <div key={group} className="flex flex-col gap-0.5">
                <p className="nav-group-label">{group}</p>
                {links}
              </div>
            );
          })}
        </nav>

        <details className="group/account border-t border-ink/10 pt-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-ink/70 hover:bg-gold/15 hover:text-ink">
            <span className="truncate">{userName}</span>
            <span aria-hidden="true" className="transition-transform group-open/account:-rotate-90">‹</span>
          </summary>
          <div className="mt-1 flex flex-col gap-0.5">
          <Link
            href="/notifications/settings"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-ink/70 transition-colors hover:bg-gold/15 hover:text-ink"
          >
            Notification settings
          </Link>
          {canNameStandIn && (
            <Link
              href="/stand-in"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-ink/70 transition-colors hover:bg-gold/15 hover:text-ink"
            >
              Away? Name a stand-in
            </Link>
          )}
          <Link
            href="/change-password"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-ink/70 transition-colors hover:bg-gold/15 hover:text-ink"
          >
            Change password
          </Link>
          <form action={signOutAction}>
            <SubmitButton className="w-full rounded-md px-3 py-2 text-left text-ink/70 transition-colors hover:bg-maroon/10 hover:text-maroon">
              Sign out
            </SubmitButton>
          </form>
          </div>
        </details>
      </aside>
    </div>
  );
}

/** Unread notifications, where people look for them: at the top, not in the list (#25). */
function NotificationsBell({ count, onNavigate }: { count: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === "/notifications";
  return (
    <Link
      href="/notifications"
      prefetch={false}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className={`relative rounded-md p-2 text-ink/70 hover:bg-gold/15 hover:text-ink ${active ? "bg-gold/15 text-ink" : ""}`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 3a4.5 4.5 0 0 0-4.5 4.5v2.7L4 13h12l-1.5-2.8V7.5A4.5 4.5 0 0 0 10 3ZM8.2 15.5a1.9 1.9 0 0 0 3.6 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-gold-deep px-1 py-0.5 text-center text-[0.6rem] leading-none font-medium text-cream">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M5 5l12 12M17 5L5 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PalmDivider() {
  return (
    <svg
      viewBox="0 0 200 16"
      className="h-4 w-full text-gold/40"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path
        d="M0 8 C 40 2, 60 2, 100 8 C 140 14, 160 14, 200 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M100 8 C 98 4, 96 2, 92 1" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M100 8 C 102 4, 104 2, 108 1" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M100 8 C 98 5, 94 4, 90 5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M100 8 C 102 5, 106 4, 110 5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
