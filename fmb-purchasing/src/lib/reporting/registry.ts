import { createAdminClient } from "@/lib/supabase/admin";
import { loadThaaliCosts, thaaliCostTables } from "@/app/(app)/menus/costs/data";
import { loadAccountingPeriod } from "@/lib/accounting-data";
import { summariseGst } from "@/lib/gst-summary";
import { parsePeriod } from "@/lib/periods";
import type { CurrentUser } from "@/lib/auth/session";
import { userCan, type ActionKey, type PageKey } from "@/lib/permissions";
import { DATE_BASIS_LABEL, type DateBasis } from "./basis.ts";
import { describeSelection, offered, standardFilters } from "./filters.ts";
import type { Measure } from "./measures.ts";
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

/** The filters a report can honour, out of the one set every report draws from (filters.ts). */
export type ReportFilterKey = "period" | "vendor" | "category" | "item" | "counting";

export type ReportDefinition = {
  key: string;
  title: string;
  /** One sentence under the title: what the report is for. */
  description: string;
  permission: { page: PageKey; action: ActionKey };
  /** The page it is a download of — and where a home-page widget from it leads. */
  path: string;
  /**
   * Its link in the row above every report, in the order listed here. Left
   * out for a report reached another way (Thaali costs, under its calendar).
   * `permission` is to see the page, when that is less than to download it.
   */
  nav?: { label: string; permission?: { page: PageKey; action: ActionKey } };
  /** Which of the standard filters it takes; the filter bar shows these and no others. */
  filters: ReportFilterKey[];
  /** The period it opens on, when that is not the current Hijri year. */
  defaultPeriod?: string;
  /** The measures its figures are (measures.ts), spelt out in the key under its title. */
  measures: Measure[];
  build(params: Params, today: string): Promise<ReportDocument>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const REPORTS: ReportDefinition[] = [
  {
    key: "spend",
    path: "/reports",
    title: "Reports",
    description: "Spending over any period — Hijri year, financial year, quarter, month or your own dates.",
    nav: { label: "Spending" },
    filters: ["period", "vendor", "category", "item", "counting"],
    measures: ["spend", "accrued", "paid"],
    permission: { page: "reports", action: "view" },
    async build(params, today) {
      const view = await loadSpendView(params, today);
      const section = SECTIONS.find((s) => s.key === view.query.section)?.label ?? "Overview";
      return {
        title: `Reports — ${section}`,
        subtitle: view.summary,
        filenameBase: safeFilename(`reports-${view.query.section}-${view.query.period}`),
        tables: spendReportTables(view.report, view.period.label, view.previousRange.label),
        filterOptions: view.options,
      };
    },
  },
  {
    key: "money-out",
    path: "/reports/money-out",
    title: "Money out",
    description:
      "What has been paid and to whom, what is waiting to be, and how long each step takes. Payees are named; bank details stay on the Payments page.",
    nav: { label: "Money out" },
    // A payment settles a whole expense, so there is no honest way to cut it by category or item.
    filters: ["period", "vendor"],
    measures: ["paid", "outstanding", "awaitingReview"],
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
    description:
      "The spend in a period that something is wrong with, or may be — receipts that don't add up, lines nobody classified, dates that can't be right — to settle before its figures are relied on.",
    nav: { label: "Exceptions" },
    filters: ["period", "vendor", "category", "counting"],
    measures: ["spend", "accrued", "paid"],
    permission: { page: "reports", action: "view" },
    async build(params, today) {
      return exceptionsDocument(await loadExceptionsView(createAdminClient(), params, today));
    },
  },
  {
    key: "budgets",
    path: "/budgets",
    title: "Budgets",
    description: "What was set aside for each category, against what has been spent. Amounts include GST.",
    nav: { label: "Budgets" },
    // Budgets are set per category, so a vendor's share of one has no budget to stand against.
    filters: ["period", "category"],
    measures: ["spend", "paid", "committed"],
    permission: { page: "budgets", action: "view" },
    async build(params, today) {
      const period = parsePeriod(one(params.period) ?? one(params.fy), today);
      const view = await loadBudgetView(createAdminClient(), period, standardFilters(params).categories);
      const selection = describeSelection({ categories: view.categories }, { categories: view.categoryOptions });
      return {
        title: "Budgets",
        subtitle: `${period.label}${selection ? ` · ${selection}` : ""} · ${DATE_BASIS_LABEL.receipt} · submitted, approved and paid · amounts include GST`,
        filenameBase: safeFilename(`budgets-${period.code}`),
        tables: budgetTables(view),
        filterOptions: { categories: view.categoryOptions },
      };
    },
  },
  {
    key: "thaali-costs",
    path: "/menus/costs",
    title: "Thaali costs",
    description: "What the thaali has cost: planned, from the prices frozen at release, and actual, from the receipts allocated back.",
    filters: ["period"],
    measures: ["spend"],
    permission: { page: "menus", action: "view" },
    async build(params, today) {
      const view = await loadThaaliCosts(createAdminClient(), params, today);
      const kitchen = view.kitchens.find((k) => k.id === view.kitchenId)?.name ?? "Both kitchens";
      return {
        title: `Thaali costs — ${view.period.label}`,
        subtitle: `${view.period.label} · ${kitchen} · planned at release prices, spent from receipts allocated to each day · dishes at today's prices`,
        filenameBase: safeFilename(`thaali-costs-${view.period.code}`),
        tables: thaaliCostTables(view),
      };
    },
  },
  {
    key: "gst",
    path: "/accounting",
    title: "GST",
    description: "GST for the return, the Xero bills file, and account codes.",
    nav: { label: "GST", permission: { page: "accounting", action: "view" } },
    // Narrowing by vendor or category is for looking into the detail. The
    // Accounting page, which shows the figures for the return, offers neither.
    filters: ["period", "vendor", "category"],
    defaultPeriod: "au-current",
    measures: ["accrued", "paid"],
    // The detail lists every line claimed on, so it takes the export grant
    // the Xero file does, not just the right to look at the page.
    permission: { page: "accounting", action: "export" },
    async build(params, today) {
      const period = parsePeriod(one(params.period) ?? "au-current", today);
      const basis: DateBasis = one(params.basis) === "paid" ? "paid" : "receipt";
      const asked = standardFilters(params);
      const { gstExpenses, gstLines, xeroLines, options } = await loadAccountingPeriod(createAdminClient(), period, basis, {
        vendors: asked.vendors,
        categories: asked.categories,
      });
      const selection = describeSelection(
        { vendors: offered(asked.vendors, options.vendors), categories: offered(asked.categories, options.categories) },
        options
      );
      return {
        title: `GST — ${period.label}`,
        subtitle: selection
          ? `${period.label} · ${selection} · ${DATE_BASIS_LABEL[basis]} · ${basis === "paid" ? "paid" : "approved and paid"} · narrowed, so not the figures for the return`
          : `${DATE_BASIS_LABEL[basis]} · ${basis === "paid" ? "paid" : "approved and paid"} · for checking against the return, with FMB's accountant`,
        filenameBase: safeFilename(`gst-${period.code}-${basis}`),
        tables: gstTables(summariseGst(gstExpenses, gstLines), gstExpenses, xeroLines),
        filterOptions: options,
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

/**
 * The links above every report: each report with a place in the row that
 * this person may open, in registry order.
 */
export async function reportNavFor(user: CurrentUser): Promise<{ key: string; label: string; href: string }[]> {
  const listed = REPORTS.filter((r) => r.nav);
  const allowed = await Promise.all(
    listed.map((r) => {
      const need = r.nav!.permission ?? r.permission;
      return userCan(user, need.page, need.action);
    })
  );
  return listed.filter((_, i) => allowed[i]).map((r) => ({ key: r.key, label: r.nav!.label, href: r.path }));
}
