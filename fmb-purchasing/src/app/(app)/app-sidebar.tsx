"use client";

import { SubmitButton } from "@/components/submit-button";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { NavLink } from "./nav-link";

type NavItem = { key: string; href: string; label: string };

export function AppSidebar({
  navItems,
  userName,
  signOutAction,
  unreadCount,
}: {
  navItems: NavItem[];
  userName: string;
  signOutAction: (formData: FormData) => void;
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative md:contents">

      {/* Mobile-only top bar: unaffected by md: below, invisible on desktop */}
      <div className="flex items-center justify-between border-b border-gold/20 bg-cream px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Image src="/fmb-logo.png" alt="FMB" width={34} height={34} className="rounded" />
          {/* Sized above body text so the header anchors the page rather than
              being dwarfed by the title beneath it. */}
          <span className="brand-wordmark text-[1.15rem] font-semibold leading-none text-ink">FMB Sydney</span>
        </Link>
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

      {/* Backdrop: closes the menu on tap, mobile only, never renders at md: */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/30 md:hidden"
        />
      )}

      <aside
        className={`${open ? "absolute flex" : "hidden"} inset-x-0 top-full z-40 max-h-[calc(100vh-4rem)] overflow-y-auto shadow-lg w-full shrink-0 flex-col gap-6 border-b border-gold/20 bg-cream px-6 py-8 md:static md:flex md:z-auto md:max-h-none md:w-64 md:overflow-visible md:border-b-0 md:border-r md:bg-gradient-to-b md:from-gold/10 md:via-cream md:to-cream md:shadow-none`}
      >
        <Link href="/" className="hidden items-center gap-3 md:flex">
          <Image src="/fmb-logo.png" alt="FMB" width={40} height={40} className="rounded" />
          <div>
            <p className="brand-wordmark text-lg font-semibold leading-tight text-ink">FMB Sydney</p>
            <p className="text-xs text-ink/60">Faiz ul Mawaid il Burhaniyah</p>
          </div>
        </Link>

        <div className="hidden md:block">
          <PalmDivider />
        </div>

        <nav className="flex flex-1 flex-col gap-1 text-sm">
          {navItems.map((item) => (
            <NavLink key={item.key} href={item.href} label={item.label} onNavigate={() => setOpen(false)} />
          ))}
          <NavLink
            href="/notifications"
            label="Notifications"
            badge={unreadCount}
            onNavigate={() => setOpen(false)}
          />
        </nav>

        <div className="flex flex-col gap-1 border-t border-ink/10 pt-4 text-sm">
          <p className="px-3 text-ink/60">{userName}</p>
          <form action={signOutAction}>
            <SubmitButton className="w-full rounded-md px-3 py-2 text-left text-ink/70 transition-colors hover:bg-maroon/10 hover:text-maroon">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </aside>
    </div>
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
