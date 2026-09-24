import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { loadReportRawData } from "./reports/data";
import { computeWidgetData, widgetPeriodCode } from "./reports/dashboard-widgets";
import { HomeDashboard, type SavedWidget } from "./home-dashboard";

export const metadata = { title: "Home" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const welcome = (
    <div>
      <h1 className="page-title text-ink">Welcome, {user.fullName || user.email}</h1>
      <p className="max-w-xl text-ink/70">
        Use the sidebar to submit an expense or, if you have access, review submissions, master data,
        and reports.
      </p>
    </div>
  );

  // A dashboard built from Reports data has no business showing up for
  // someone who can't see Reports — the widgets stay hidden entirely rather
  // than rendered empty, so no figure a person shouldn't see ever ships.
  const canViewReports = await userCan(user, "reports", "view");
  if (!canViewReports) {
    return <div className="flex flex-col gap-4">{welcome}</div>;
  }

  const admin = createAdminClient();
  const today = todayIso();

  const [{ data: widgetRows }, earliest] = await Promise.all([
    admin
      .from("user_dashboard_widgets")
      .select("id, kind, title, config")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true }),
    earliestExpenseDate(admin),
  ]);

  const rows = (widgetRows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as SavedWidget["kind"],
    title: r.title as string,
    config: r.config as SavedWidget["config"],
  }));

  // One fetch per distinct period across every saved widget, not one per
  // widget — several widgets commonly share a period.
  const distinctCodes = [...new Set(rows.map((r) => widgetPeriodCode(r.config)))];
  const rawByCode = new Map(
    await Promise.all(
      distinctCodes.map(async (code) => [code, await loadReportRawData(parsePeriod(code, today))] as const)
    )
  );

  const widgets: SavedWidget[] = rows.map((r) => ({
    ...r,
    data: computeWidgetData(r.kind, r.config, rawByCode.get(widgetPeriodCode(r.config))!, today),
    periodLabel: parsePeriod(widgetPeriodCode(r.config), today).label,
  }));

  return (
    <div className="flex flex-col gap-6">
      {welcome}
      <HomeDashboard widgets={widgets} today={today} earliest={earliest} />
    </div>
  );
}
