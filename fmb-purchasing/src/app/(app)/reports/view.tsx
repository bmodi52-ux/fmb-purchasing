import type { CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { forScreen } from "@/lib/reporting/spend-report";
import { transactionsPage } from "@/lib/reporting/spend-tables";
import { loadSpendView } from "@/lib/reporting/spend-view";
import { tableStateFrom } from "@/lib/reporting/table-view";
import { loadSavedViews } from "@/lib/saved-report-views";
import { findReport } from "@/lib/reporting/registry";
import { ReportHeader } from "./report-header";
import { ReportsView } from "./reports-view";
import { SpendingActions } from "./spending-actions";

/** The Spending report: what was spent, by category, vendor and item. */
export async function SpendingReport({
  user,
  params,
}: {
  user: CurrentUser;
  // vendor, category and item repeat, so each arrives as an array when more
  // than one is selected and as a bare string when exactly one is.
  params: Record<string, string | string[] | undefined>;
}) {
  const admin = createAdminClient();
  const [view, earliest, savedViews, { data: teams }] = await Promise.all([
    // Worked out on the server, so the browser is sent the figures rather
    // than the rows — and shared with the download of this page.
    loadSpendView(params, todayIso()),
    earliestExpenseDate(admin),
    loadSavedViews(admin, user),
    admin.from("teams").select("id, name").order("name"),
  ]);

  return (
    <ReportsView
      query={view.query}
      report={forScreen(view.report)}
      // One page of the lines, sorted and cut here — not every line of the period.
      transactions={transactionsPage(view.report, tableStateFrom(params))}
      today={todayIso()}
      earliest={earliest}
      vendors={view.options.vendors}
      categories={view.options.categories}
      items={view.options.items}
      periodLabel={view.period.label}
      previousLabel={view.previousRange.label}
      hasCategoryOrItemFilter={view.query.categories.length > 0 || view.query.items.length > 0}
      header={
        <ReportHeader
          report="spend"
          user={user}
          basis={view.basisLabel}
          actions={
            <SpendingActions
              query={view.query}
              summary={view.summary}
              empty={view.report.now.expenseCount === 0}
              savedViews={savedViews}
              userId={user.id}
              teams={(teams ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))}
            />
          }
        />
      }
      filters={findReport("spend")!.filters}
    />
  );
}
