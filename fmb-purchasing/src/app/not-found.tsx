import Link from "next/link";

/**
 * A page that isn't there — most often an expense number typed by hand, or a
 * link from a notification about something since deleted.
 *
 * Note what this deliberately does not say. The expense detail page redirects
 * rather than 404s when someone lacks permission (see expense-access.ts), so
 * reaching here genuinely means "no such page" and never "not yours" — which
 * is why it can be this direct without leaking whether a record exists.
 *
 * Lives at the app root rather than inside (app), so it renders without the
 * sidebar: a stranger following a stale link has no session to build one from.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <main className="flex max-w-md flex-col gap-4">
        <p className="text-xs uppercase tracking-[0.06em] text-ink/45">FMB Sydney</p>
        <h1 className="page-title text-ink">We couldn&rsquo;t find that page</h1>
        <p className="page-description">
          The link may be out of date, or the entry it pointed to may have been removed. If you
          followed it from an email or a notification, the expense it referred to is probably still
          listed under your submissions.
        </p>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <Link
            href="/"
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep hover:text-white"
          >
            Go to the dashboard
          </Link>
          <Link href="/my-submissions" className="text-sm text-ink/60 underline hover:text-ink">
            My submissions
          </Link>
        </div>
      </main>
    </div>
  );
}
