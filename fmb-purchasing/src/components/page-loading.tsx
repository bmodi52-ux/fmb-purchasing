"use client";

import { useEffect, useRef, useState } from "react";
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
 * The label fades in after 450ms in CSS rather than in JavaScript, so a page
 * that resolves quickly shows a moving hairline and nothing else, and only a
 * wait long enough to worry about earns a word.
 *
 * It never changed after that, though, so five minutes looked the same as five
 * seconds (#57). Now it names the page, says so when the wait is longer than
 * usual, offers Try again, and after twenty seconds says something may be
 * wrong. A slow load is recorded on /admin/errors: when the page arrives, if
 * it took more than eight seconds, or at twenty if it still hasn't.
 */
export function PageLoading({ label }: { label?: string }) {
  const pathname = usePathname();
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef(0);
  const reported = useRef(false);

  useEffect(() => {
    startedAt.current = Date.now();
    reported.current = false;
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= STUCK_AFTER && !reported.current) {
        reported.current = true;
        void reportSlowLoad({ pathname, seconds: elapsed, finished: false }).catch(() => {});
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (!reported.current && elapsed >= SLOW_AFTER) {
        reported.current = true;
        void reportSlowLoad({ pathname, seconds: elapsed, finished: true }).catch(() => {});
      }
    };
  }, [pathname]);

  const name = label ?? pageNameFor(pathname);
  const slow = seconds >= SLOW_AFTER;
  const stuck = seconds >= STUCK_AFTER;

  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="route-progress" aria-hidden="true" />
      {!slow ? (
        <span className="page-loading-label">Loading {name}…</span>
      ) : (
        <div className="flex max-w-sm flex-col items-center gap-3 px-4 text-center text-sm">
          <p className="text-ink/70">
            {stuck ? (
              <>
                <strong className="font-medium text-ink">Something may be wrong.</strong> This page has been loading for{" "}
                {seconds} seconds. It&apos;s been noted for whoever looks after the app.
              </>
            ) : (
              <>Still loading {name} — this is taking longer than usual.</>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep"
            >
              Try again
            </button>
            {stuck && (
              <Link href="/" className="text-ink/60 underline hover:text-ink">
                Go to home
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
