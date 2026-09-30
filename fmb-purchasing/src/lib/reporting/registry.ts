import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccountingPeriod } from "@/lib/accounting-data";
import { summariseGst } from "@/lib/gst-summary";
import { parsePeriod } from "@/lib/periods";
import type { CurrentUser } from "@/lib/auth/session";
import { userCan, type ActionKey, type PageKey } from "@/lib/permissions";
import { DATE_BASIS_LABEL, type DateBasis } from "./basis.ts";
import { budgetTables, loadBudgetView } from "./budget-view.ts";
import { gstTables } from "./gst-tables.ts";
import { SECTIONS } from "./query.ts";
import { spendReportTables } from "./spend-tables.ts";
import { loadSpendView } from "./spend-view.ts";
import { exceptionsDocument, loadExceptionsView } from "./exceptions-data.ts";
import { loadMoneyOutView, moneyOutDocument } from "./money-out-view.ts";
import { safeFilename, type ReportDocument } from "./tables.ts";

/**
 * Every report that can be downloaded: who may, and how it is built — from
 * the same loader its page uses, and the same URL parameters, so a download
 * is always the page it was taken from.
 *
 * Adding a report is adding an entry here. The download route
 * (app/(app)/reports/export) knows nothing about any of them.
 */

type Params = Record<string, string | string[] | undefined>;

export type ReportDefinition = {
  key: string;
  title: string;
  permission: { page: PageKey; action: ActionKey };
  /** The page it is a download of — and where a home-page widget from it leads. */
  path: string;
  build(params: Params, today: string): Promise<ReportDocument>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const REPORTS: ReportDefinition[] = [
  {
    key: "money-out",
    path: "/reports/money-out",
    title: "Money out",
    // Payee names and amounts, never bank details — those stay on Payments.
    permission: { page: "reports", action: "view" },
    async build(params, today) {
      return moneyOutDocument(await loadMoneyOutView(createAdminClient(), params, today), today);
    },
  },
  {
    key: "exceptions",
    path: "/reports/exceptions",
    title: "Exceptions",
    permission: { page: "reports", action: "view" },
    async build(params, today) {
      return exceptionsDocument(await loadExceptionsView(createAdminClient(), params, today));
    },
  },
  {
    key: "spend",
    path: "/reports",
    title: "Reports",
    permission: { page: "reports", action: "view" },
    async build(params, today) {
      const view = await loadSpendView(params, today);
      const section = SECTIONS.find((s) => s.key === view.query.section)?.label ?? "Overview";
      return {
        title: `Reports — ${section}`,
        subtitle: view.summary,
        filenameBase: safeFilename(`reports-${view.query.section}-${view.query.period}`),
        tables: spendReportTables(view.report, view.period.label, view.previousRange.label),
      };
    },
  },
  {
    key: "budgets",
    path: "/budgets",
    title: "Budgets",
    permission: { page: "budgets", action: "view" },
    async build(params, today) {
      const period = parsePeriod(one(params.period) ?? one(params.fy), today);
      const view = await loadBudgetView(createAdminClient(), period);
      return {
        title: "Budgets",
        subtitle: `${period.label} · ${DATE_BASIS_LABEL.receipt} · submitted, approved and paid · amounts include GST`,
        filenameBase: safeFilename(`budgets-${period.code}`),
        tables: budgetTables(view),
      };
    },
  },
  {
    key: "gst",
    path: "/accounting",
    title: "GST",
    // The detail lists every line claimed on, so it takes the export grant
    // the Xero file does, not just the right to look at the page.
    permission: { page: "accounting", action: "export" },
    async build(params, today) {
      const period = parsePeriod(one(params.period) ?? "au-current", today);
      const basis: DateBasis = one(params.basis) === "paid" ? "paid" : "receipt";
      const { gstExpenses, gstLines, xeroLines } = await loadAccountingPeriod(createAdminClient(), period, basis);
      return {
        title: `GST — ${period.label}`,
        subtitle: `${DATE_BASIS_LABEL[basis]} · ${basis === "paid" ? "paid" : "approved and paid"} · for checking against the return, with FMB's accountant`,
        filenameBase: safeFilename(`gst-${period.code}-${basis}`),
        tables: gstTables(summariseGst(gstExpenses, gstLines), gstExpenses, xeroLines),
      };
    },
  },
];

export function findReport(key: string | undefined): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === (key ?? "spend"));
}

/** Whether someone may see a report — its page, its download, a widget from it. */
export async function canSeeReport(user: CurrentUser, key: string): Promise<boolean> {
  const report = REPORTS.find((r) => r.key === key);
  return report ? userCan(user, report.permission.page, report.permission.action) : false;
}
