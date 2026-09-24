import Link from "next/link";
import { can, getUserPermissions } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIso } from "@/lib/periods-data";
import { loadReviewQueue } from "./review-queue/data";
import type { getCurrentUser } from "@/lib/auth/session";

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

type Tile = { href: string; figure: string; label: string; note?: string; urgent?: boolean };

/**
 * What needs you today (#28). The home page was one widget on an empty page,
 * under a line telling you to use the sidebar. This is the sidebar's answer
 * before you open it: what is waiting on you, from each place you can act.
 * Only what the person may see is counted, and a count of nothing is left out
 * rather than shown as a zero to scan past.
 */
export async function TodayPanel({ user }: { user: User }) {
  const permissions = await getUserPermissions(user);
  const admin = createAdminClient();
  const today = todayIso();

  const canApprove = can(permissions, "approvals", "approve");
  const canPay = can(permissions, "payments", "view");
  const canQueue = can(permissions, "review_queue", "view");
  const canMenus = can(permissions, "menus", "view");
  const canSubmit = can(permissions, "submit_expense", "submit");

  const [mine, waiting, toPay, queue, menuToday] = await Promise.all([
    admin.from("expenses").select("status, decided_at").eq("submitted_by", user.id).in("status", ["submitted", "declined"]),
    canApprove ? admin.from("expenses").select("total").eq("status", "submitted") : Promise.resolve({ data: null }),
    canPay ? admin.from("expenses").select("total").eq("status", "approved") : Promise.resolve({ data: null }),
    canQueue ? loadReviewQueue() : Promise.resolve(null),
    canMenus
      ? admin.from("menu_days").select("planned_thaalis, confirmed_thaalis").eq("service_date", today)
      : Promise.resolve({ data: null }),
  ]);

  const tiles: Tile[] = [];

  // A resubmission is a new expense with no link back, so a declined one
  // stays declined for good; only a recent decline is still news.
  const fortnightAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const declined = (mine.data ?? []).filter(
    (e) => e.status === "declined" && (e.decided_at as string | null) != null && (e.decided_at as string) >= fortnightAgo
  ).length;
  const pending = (mine.data ?? []).filter((e) => e.status === "submitted").length;
  if (declined > 0)
    tiles.push({
      href: "/my-submissions",
      figure: String(declined),
      label: "of yours declined this fortnight",
      note: "Fix and resubmit",
      urgent: true,
    });

  if (waiting.data && waiting.data.length > 0)
    tiles.push({
      href: "/approvals",
      figure: String(waiting.data.length),
      label: "waiting for approval",
      note: money(waiting.data.reduce((sum, e) => sum + Number(e.total ?? 0), 0)),
    });

  if (toPay.data && toPay.data.length > 0)
    tiles.push({
      href: "/payments",
      figure: String(toPay.data.length),
      label: "approved, to pay",
      note: money(toPay.data.reduce((sum, e) => sum + Number(e.total ?? 0), 0)),
    });

  if (queue && queue.items.length > 0)
    tiles.push({ href: "/review-queue", figure: String(queue.items.length), label: "need attention" });

  if (menuToday.data && menuToday.data.length > 0) {
    const thaalis = menuToday.data.reduce(
      (sum, d) => sum + Number(d.confirmed_thaalis ?? d.planned_thaalis ?? 0),
      0
    );
    tiles.push({ href: "/menus", figure: String(thaalis), label: "thaalis today", note: "Thaali Calendar" });
  }

  if (pending > 0)
    tiles.push({
      href: "/my-submissions",
      figure: String(pending),
      label: pending === 1 ? "of yours is awaiting review" : "of yours are awaiting review",
    });

  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="today-heading" className="section-title text-ink">
          Today
        </h2>
        {canSubmit && (
          <Link href="/submit" className="btn btn-primary btn-sm">
            + Submit expense
          </Link>
        )}
      </div>
      {tiles.length === 0 ? (
        <p className="card p-5 text-sm text-ink/60">Nothing is waiting on you.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <li key={`${t.href}-${t.label}`}>
              <Link
                href={t.href}
                className={`card flex h-full flex-col gap-1 p-4 transition-colors hover:border-gold-deep/50 ${
                  t.urgent ? "border-alert/30" : ""
                }`}
              >
                <span className={`text-3xl font-semibold tracking-tight tabular-nums ${t.urgent ? "text-alert" : "text-ink"}`}>
                  {t.figure}
                </span>
                <span className="text-sm text-ink/75">{t.label}</span>
                {t.note && <span className="text-xs text-ink/50">{t.note}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
