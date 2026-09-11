"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a submitter sees when a page inside the app throws.
 *
 * Until now they saw Next's own error screen: unbranded, in English aimed at
 * a developer, with no way back and no indication that anyone had been told.
 * For an app whose users are volunteers and committee members rather than
 * engineers, that is the moment they stop trusting it and go back to email.
 *
 * Three things this has to do, in order of what actually helps:
 *   1. say something true and non-alarming,
 *   2. offer a way onward — retry first, since a failed database round trip
 *      to Sydney often succeeds on the second attempt,
 *   3. show the digest, because that is the only thread connecting what the
 *      person saw to the entry in the platform log.
 *
 * `retry` rather than `reset`: `reset` only clears the boundary, while `retry`
 * also refetches the segment. (It was `unstable_retry` before Next 16.3.)
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Server-thrown errors arrive here with their message already stripped,
    // so this is mostly of use for client-side faults. The server side is
    // covered by reportError, which is what puts a row on /admin/errors.
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="page-title text-ink">Something went wrong on this page</h1>
      <p className="page-description">
        The page didn&rsquo;t load properly. This is usually temporary — trying again often works.
        Nothing you submitted has been lost.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep hover:text-white"
        >
          Try again
        </button>
        <Link href="/" className="text-sm text-ink/60 underline hover:text-ink">
          Back to the dashboard
        </Link>
      </div>

      {error.digest && (
        <p className="mt-2 text-xs text-ink/45">
          If it keeps happening, quote this reference:{" "}
          <span className="font-mono text-ink/70">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
