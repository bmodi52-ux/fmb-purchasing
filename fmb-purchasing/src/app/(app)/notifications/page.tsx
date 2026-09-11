import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { recentNotifications } from "@/lib/notifications-inapp";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { markNotificationRead, markAllNotificationsRead, clearReadNotifications } from "./actions";

export const metadata = { title: "Notifications" };

/** Every signed-in user has notifications, so this page is not permission-gated. */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const notifications = await recentNotifications(user.id);
  const unread = notifications.filter((n) => !n.read_at);
  const read = notifications.filter((n) => n.read_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="page-title text-ink">Notifications</h1>
          <p className="page-description mt-1 max-w-xl">
            Submissions, decisions, payments, reminders and announcements that involve you. Choose which of them also
            reach you by push or email in Settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/notifications/settings"
            className="whitespace-nowrap rounded-md border border-ink/15 px-3 py-1.5 text-sm hover:border-ink/30"
          >
            Settings
          </Link>
          {unread.length > 0 && (
            <form action={markAllNotificationsRead}>
              <SubmitButton
                pendingLabel="Marking…"
                className="whitespace-nowrap rounded-md border border-ink/15 px-3 py-1.5 text-sm hover:border-ink/30"
              >
                Mark all read
              </SubmitButton>
            </form>
          )}
          {read.length > 0 && (
            <form action={clearReadNotifications}>
              <SubmitButton
                pendingLabel="Clearing…"
                className="whitespace-nowrap rounded-md border border-ink/15 px-3 py-1.5 text-sm text-ink/60 hover:border-ink/30 hover:text-ink"
              >
                Clear read
              </SubmitButton>
            </form>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-ink/50">
          Nothing yet. You&apos;ll be notified here when an expense you submitted is decided or paid, and when
          something needs your review.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {unread.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="section-title text-ink">Unread ({unread.length})</h2>
              {unread.map((n) => (
                <NotificationCard key={n.id} notification={n} />
              ))}
            </section>
          )}

          {read.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="section-title text-ink/60">Earlier</h2>
              {read.map((n) => (
                <NotificationCard key={n.id} notification={n} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationCard({
  notification: n,
}: {
  notification: {
    id: string;
    title: string;
    body: string | null;
    link: string | null;
    expense_id: string | null;
    read_at: string | null;
    created_at: string;
  };
}) {
  const isUnread = !n.read_at;

  // The expense itself, not the list it happens to sit on. Notifications
  // recorded before that was true still carry a /my-submissions or /approvals
  // link, so the expense the row already names wins over the stored link —
  // which fixes the ones already sent as well as the ones still to come.
  const href = n.expense_id ? `/expenses/${n.expense_id}` : n.link;

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between ${
        isUnread ? "border-gold/40 bg-gold/5" : "border-ink/10 bg-white/60"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-ink ${isUnread ? "font-medium" : ""}`}>
          {isUnread && <span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gold-deep align-middle" />}
          {n.title}
        </p>
        {n.body && <p className="mt-0.5 text-sm text-ink/70">{n.body}</p>}
        <p className="mt-1 text-xs text-ink/40">{formatDateTime(n.created_at)}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {href && (
          <Link href={href} prefetch={false} className="text-sm text-ink underline hover:text-gold-deep">
            View
          </Link>
        )}
        {isUnread && (
          <form action={markNotificationRead}>
            <input type="hidden" name="notification_id" value={n.id} />
            <SubmitButton className="text-sm text-ink/50 hover:text-ink hover:underline">Mark read</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
