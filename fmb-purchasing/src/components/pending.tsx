"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type PendingApi = { begin: () => void; end: () => void };

const PendingContext = createContext<PendingApi | null>(null);

/**
 * One progress indicator for everything that makes the user wait.
 *
 * Navigating already showed a bar, but approving, saving or marking paid did
 * not — and those run against a database on the other side of the Pacific, so
 * a click sat there doing nothing visible for a second or more. Anything
 * in-flight reports here and the same hairline appears, so "the app is
 * working on it" looks identical wherever it comes from.
 *
 * A counter rather than a boolean: several things can overlap (a bulk action
 * while a navigation resolves), and the bar should persist until the last one
 * finishes rather than the first one clearing it.
 */
export function PendingProvider({ children }: { children: React.ReactNode }) {
  const [inFlight, setInFlight] = useState(0);

  const begin = useCallback(() => setInFlight((n) => n + 1), []);
  const end = useCallback(() => setInFlight((n) => Math.max(0, n - 1)), []);
  const api = useMemo(() => ({ begin, end }), [begin, end]);

  return (
    <PendingContext.Provider value={api}>
      {inFlight > 0 && (
        <>
          <span className="route-progress" aria-hidden />
          <span role="status" aria-live="polite" className="sr-only">
            Working
          </span>
        </>
      )}
      {children}
    </PendingContext.Provider>
  );
}

/**
 * Report a pending flag for as long as it is true. Cleanup runs on unmount
 * too, so a component disappearing mid-flight (a row removed by the very
 * action it started) can't leave the bar stuck on.
 */
export function useReportPending(pending: boolean) {
  const ctx = useContext(PendingContext);

  useEffect(() => {
    if (!ctx || !pending) return;
    ctx.begin();
    return ctx.end;
  }, [ctx, pending]);
}
