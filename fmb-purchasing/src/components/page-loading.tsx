"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { pageNameFor } from "@/lib/page-names";
import { reportSlowLoad } from "@/lib/slow-load-actions";

/** Seconds before the wait is called out, and before it's called a problem. */
const SLOW_AFTER = 8;
const STUCK_AFTER = 20;

/**
 * What a page looks like while its data crosses the Pacific.
 *
 * This used to be a block skeleton per route — a page-shaped arrangement of
 * grey bars, added because the 2px hairline alone was judged "enough to know
 * the tap registered, not enough to stop the page feeling stalled". In use it
 * went the other way. On a wide desktop viewport the bars stretch to the full
 * width of the content column and read as a broken page rather than a loading
 * one, and the Submit skeleton did not even match the form that replaced it
 * (four fields and a slab, where the real page opens with the attachments
 * area), so it never bought the no-jump benefit that justified it.
 *
 * So the hairline is the signal again, and it is drawn here rather than left
 * to the shared PendingProvider: a route with a loading.tsx resolves its
 * navigation as soon as this renders, which ends the pending state that would
 * otherwise be keeping the bar on screen. Without this the bar would vanish at
 * exactly the moment there is nothing else to look at.
 *
 * It never changed after that, though, so five minutes looked the same as five
 * seconds (#57). It now names the page, says after eight seconds that the wait
 * is longer than usual, and after twenty that something may be wrong — and
 * records the slow load on /admin/errors.
 *
 * EVERY WORD OF THAT IS REVEALED BY CSS, and this component never sets state.
 * The first attempt ticked a one-second timer to count the wait, which re-
 * rendered the fallback continuously: React then never committed the page it
 * had already fetched, so a page that took two seconds to load sat on "Loading
 * Submit expense…" for ever. A fallback has to render once and then keep
 * still. It is also why the wait is measured from Date.now() when it is
 * reported rather than held in state.
 */
export function PageLoading({ label }: { label?: string }) {
  const pathname = usePathname();
  const startedAt = useRef(0);
  const reported = useRef(false);

  useEffect(() => {
    startedAt.current = Date.now();
    reported.current = false;

    // Still here after twenty seconds: report it now rather than waiting to
    // find out whether the page ever arrives.
    const stuck = setTimeout(() => {
      reported.current = true;
      void reportSlowLoad({ pathname, seconds: STUCK_AFTER, finished: false }).catch(() => {});
    }, STUCK_AFTER * 1000);

    return () => {
      clearTimeout(stuck);
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (!reported.current && elapsed >= SLOW_AFTER) {
        reported.current = true;
        void reportSlowLoad({ pathname, seconds: elapsed, finished: true }).catch(() => {});
      }
    };
  }, [pathname]);

  const name = label ?? pageNameFor(pathname);

  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="route-progress" aria-hidden="true" />

      <span className="page-loading-label">Loading {name}…</span>

      <div className="page-loading-slow">
        <p>Still loading {name} — this is taking longer than usual.</p>
        <TryAgain />
      </div>

      <div className="page-loading-stuck">
        <p>
          <strong className="font-medium text-ink">Something may be wrong.</strong> This page still hasn&apos;t
          loaded. It&apos;s been noted for whoever looks after the app.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <TryAgain />
          <Link href="/" className="text-ink/60 underline hover:text-ink">
            Go to home
          </Link>
        </div>
      </div>
    </div>
  );
}

function TryAgain() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="btn btn-primary"
    >
      Try again
    </button>
  );
}
