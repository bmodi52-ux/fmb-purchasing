import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { fiscalYearHijri } from "@/lib/fiscal-year";
import { loadReportRawData } from "./reports/data";
import { computeWidgetData } from "./reports/dashboard-widgets";
import { HomeDashboard, type SavedWidget } from "./home-dashboard";

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
  const currentFy = fiscalYearHijri(new Date());

  const [{ data: widgetRows }, { data: fyRows }] = await Promise.all([
    admin
      .from("user_dashboard_widgets")
      .select("id, kind, title, config")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true }),
    admin.from("expense_fiscal_years").select("fiscal_year_hijri"),
  ]);

  const fiscalYears = [...new Set((fyRows ?? []).map((r) => r.fiscal_year_hijri))].sort(
    (a, b) => b - a
  );
  if (!fiscalYears.includes(currentFy)) fiscalYears.unshift(currentFy);

  const rows = (widgetRows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as SavedWidget["kind"],
    title: r.title as string,
    config: r.config as SavedWidget["config"],
  }));

  // One fetch per distinct fiscal year across every saved widget, not one
  // per widget — several widgets commonly share a year.
  const distinctFys = [...new Set(rows.map((r) => r.config.fy))];
  const rawByFy = new Map(
    await Promise.all(distinctFys.map(async (fy) => [fy, await loadReportRawData([fy])] as const))
  );

  const widgets: SavedWidget[] = rows.map((r) => ({
    ...r,
    data: computeWidgetData(r.kind, r.config, rawByFy.get(r.config.fy)!),
  }));

  return (
    <div className="flex flex-col gap-6">
      {welcome}
      <HomeDashboard widgets={widgets} fiscalYears={fiscalYears} currentFy={currentFy} />
    </div>
  );
}
