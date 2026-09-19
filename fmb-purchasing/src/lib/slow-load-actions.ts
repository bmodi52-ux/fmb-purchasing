"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { reportError } from "@/lib/errors";
import { pathPattern } from "@/lib/page-names";

/**
 * A page that sat on its loading screen long enough to worry about (#57),
 * put on /admin/errors so slow pages show up without anyone reporting them.
 *
 * Grouped by page rather than by visit: the message names the page with any
 * record id taken out, so a slow expense page is one entry that counts up,
 * and admins are told once rather than every time.
 */
export async function reportSlowLoad({
  pathname,
  seconds,
  finished,
}: {
  pathname: string;
  seconds: number;
  /** False when it was still loading as this was sent. */
  finished: boolean;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const page = pathPattern(pathname).slice(0, 200);
  const waited = Math.round(Math.max(0, Math.min(seconds, 3600)));
  await reportError({
    source: "slow-page-load",
    error: `Slow to load: ${page}`,
    detail: finished
      ? `${pathname.slice(0, 300)} took ${waited}s to load.`
      : `${pathname.slice(0, 300)} was still loading after ${waited}s.`,
    userId: user.id,
  });
}
