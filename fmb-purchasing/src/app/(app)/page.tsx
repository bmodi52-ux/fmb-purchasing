import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { canSeeReport, findReport } from "@/lib/reporting/registry";
import { computeWidgets } from "@/lib/reporting/widget-data";
import { readWidget, widgetHref, type WidgetReport, type WidgetSpec } from "@/lib/reporting/widgets";
import { HomeDashboard, type SavedWidget } from "./home-dashboard";
import { TodayPanel } from "./today-panel";

export const metadata = { title: "Home" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const firstName = (user.fullName || user.email).split(/[\s@]/)[0];
  const welcome = (
    <>
      <div>
        <h1 className="page-title text-ink">Welcome, {firstName}</h1>
        <p className="page-description mt-1">
          {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>
      <TodayPanel user={user} />
    </>
  );

  // A dashboard built from Reports data has no business showing up for
  // someone who can't see Reports — the widgets stay hidden entirely rather
  // than rendered empty, so no figure a person shouldn't see ever ships.
  const canViewReports = await userCan(user, "reports", "view");
  if (!canViewReports) {
    return <div className="flex flex-col gap-6">{welcome}</div>;
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

  // Each row as a spec, whichever shape it was saved in — and only for a
  // report its owner can still see, by the registry's own rule.
  const read = (widgetRows ?? []).flatMap((r) => {
    const spec = readWidget({ kind: r.kind as string, config: r.config });
    return spec ? [{ id: r.id as string, title: r.title as string, spec }] : [];
  });
  const reports = [...new Set(read.map((r) => r.spec.report))];
  const visible = new Set<WidgetReport>(
    (await Promise.all(reports.map(async (key) => ((await canSeeReport(user, key)) ? [key] : [])))).flat()
  );
  const rows = read.filter((r) => visible.has(r.spec.report));

  // Widgets on the same report with the same settings share one load of it.
  const computed = await computeWidgets(
    admin,
    rows.map((r) => r.spec),
    today
  );

  const widgets: SavedWidget[] = rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    spec: r.spec as WidgetSpec,
    data: computed[i].data,
    summary: computed[i].summary,
    href: widgetHref(r.spec, findReport(r.spec.report)!.path),
  }));

  return (
    <div className="flex flex-col gap-6">
      {welcome}
      <HomeDashboard widgets={widgets} today={today} earliest={earliest} />
    </div>
  );
}
