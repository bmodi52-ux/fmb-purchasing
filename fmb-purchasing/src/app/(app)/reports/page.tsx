import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { forScreen } from "@/lib/reporting/spend-report";
import { loadSpendView } from "@/lib/reporting/spend-view";
import { loadSavedViews } from "@/lib/saved-report-views";
import { ReportsView } from "./reports-view";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  // vendor, category and item repeat, so each arrives as an array when more
  // than one is selected and as a bare string when exactly one is.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const admin = createAdminClient();
  const [view, earliest, savedViews, { data: teams }] = await Promise.all([
    // Worked out on the server, so the browser is sent the figures rather
    // than the rows — and shared with the download of this page.
    loadSpendView(await searchParams, todayIso()),
    earliestExpenseDate(admin),
    loadSavedViews(admin, user),
    admin.from("teams").select("id, name").order("name"),
  ]);

  return (
    <ReportsView
      query={view.query}
      report={forScreen(view.report)}
      basisLabel={view.basisLabel}
      summary={view.summary}
      today={todayIso()}
      earliest={earliest}
      vendors={view.options.vendors}
      categories={view.options.categories}
      items={view.options.items}
      periodLabel={view.period.label}
      previousLabel={view.previousRange.label}
      hasCategoryOrItemFilter={view.query.categories.length > 0 || view.query.items.length > 0}
      savedViews={savedViews}
      userId={user.id}
      teams={(teams ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))}
    />
  );
}
