import type { SupabaseClient } from "@supabase/supabase-js";
import { monthCalendarFor, parsePeriod, type Period } from "@/lib/periods";
import type { FilterOption } from "./aggregate.ts";
import { describeSelection, offered, optionsOf, standardFilters } from "./filters.ts";
import { MEASURES } from "./measures.ts";
import {
  loadAwaitingPayment,
  loadAwaitingReview,
  loadDecidedIn,
  loadPaidIn,
} from "./money-out-data.ts";
import {
  paymentsMade,
  paymentsMadeTables,
  pipeline,
  pipelineTables,
  waiting,
  waitingTables,
  type MoneyExpense,
  type PaymentsMade,
  type Pipeline,
  type Waiting,
} from "./money-out.ts";
import { safeFilename, type ReportDocument } from "./tables.ts";

/**
 * The Money out page's data, from its URL — shared by the page and its
 * download, so a file is always the page it came from.
 */

export type MoneyOutSection = "paid" | "waiting" | "pipeline";

export const MONEY_OUT_SECTIONS: { key: MoneyOutSection; label: string }[] = [
  { key: "paid", label: "Payments made" },
  { key: "waiting", label: MEASURES.outstanding.plain },
  { key: "pipeline", label: "Pipeline" },
];

export type MoneyOutView = (
  | { section: "paid"; period: Period; report: PaymentsMade }
  | { section: "waiting"; report: Waiting }
  | { section: "pipeline"; period: Period; report: Pipeline }
) & {
  /** The vendors with anything in the section, for the filter menu. */
  vendorOptions: FilterOption[];
  /** The vendors it is narrowed to; none means all of them. */
  vendors: string[];
};

/** What a section is built from, before any filter. Each list only where the section reads it. */
export type MoneyOutRows = {
  submitted?: MoneyExpense[];
  approved?: MoneyExpense[];
  decidedInPeriod?: MoneyExpense[];
  paidInPeriod?: MoneyExpense[];
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function moneyOutSection(params: Params): MoneyOutSection {
  const s = one(params.section);
  return MONEY_OUT_SECTIONS.some((x) => x.key === s) ? (s as MoneyOutSection) : "paid";
}

export async function loadMoneyOutView(admin: SupabaseClient, params: Params, today: string): Promise<MoneyOutView> {
  const section = moneyOutSection(params);
  const asked = standardFilters(params).vendors;
  if (section === "waiting") {
    return moneyOutViewFrom(section, null, { approved: await loadAwaitingPayment(admin) }, asked, today);
  }

  const period = parsePeriod(one(params.period), today);
  if (section === "paid") {
    return moneyOutViewFrom(section, period, { paidInPeriod: await loadPaidIn(admin, period) }, asked, today);
  }

  const [submitted, approved, decidedInPeriod, paidInPeriod] = await Promise.all([
    loadAwaitingReview(admin),
    loadAwaitingPayment(admin),
    loadDecidedIn(admin, period),
    loadPaidIn(admin, period),
  ]);
  return moneyOutViewFrom(section, period, { submitted, approved, decidedInPeriod, paidInPeriod }, asked, today);
}

/**
 * A section from its rows, narrowed to the vendors asked for. Pure. The
 * vendor menu offers every vendor in the section's rows, and a vendor asked
 * for that has nothing in them is dropped rather than selecting nothing.
 */
export function moneyOutViewFrom(
  section: MoneyOutSection,
  period: Period | null,
  rows: MoneyOutRows,
  askedVendors: string[],
  today: string
): MoneyOutView {
  const all = [...(rows.submitted ?? []), ...(rows.approved ?? []), ...(rows.decidedInPeriod ?? []), ...(rows.paidInPeriod ?? [])];
  const vendorOptions = optionsOf(all.map((e) => ({ key: e.vendorKey, label: e.vendor })));
  const vendors = offered(askedVendors, vendorOptions);
  const wanted = new Set(vendors);
  const keep = (list: MoneyExpense[] = []) => (vendors.length ? list.filter((e) => wanted.has(e.vendorKey)) : list);
  const filter = { vendorOptions, vendors };

  if (section === "waiting") {
    return { section, report: waiting(keep(rows.approved), (e) => e.decidedOn, today), ...filter };
  }
  const calendar = monthCalendarFor(period!);
  if (section === "paid") {
    return { section, period: period!, report: paymentsMade(keep(rows.paidInPeriod), calendar), ...filter };
  }
  return {
    section,
    period: period!,
    report: pipeline(
      {
        submitted: keep(rows.submitted),
        approved: keep(rows.approved),
        decidedInPeriod: keep(rows.decidedInPeriod),
        paidInPeriod: keep(rows.paidInPeriod),
      },
      today,
      calendar
    ),
    ...filter,
  };
}

export function moneyOutDocument(view: MoneyOutView, today: string): ReportDocument {
  return { ...moneyOutTables(view, today), filterOptions: { vendors: view.vendorOptions } };
}

function moneyOutTables(view: MoneyOutView, today: string): ReportDocument {
  const selection = describeSelection({ vendors: view.vendors }, { vendors: view.vendorOptions });
  const narrowed = selection ? ` · ${selection}` : "";
  if (view.section === "waiting") {
    return {
      title: "Awaiting payment",
      subtitle: `Approved and not yet paid, as of ${today} · days counted from approval${narrowed}`,
      filenameBase: safeFilename(`awaiting-payment-${today}`),
      tables: waitingTables("Awaiting payment", "Approved", view.report),
    };
  }
  if (view.section === "paid") {
    return {
      title: `Payments made — ${view.period.label}`,
      subtitle: `${view.period.label} · by payment date · payee names only, no bank details${narrowed}`,
      filenameBase: safeFilename(`payments-made-${view.period.code}`),
      tables: paymentsMadeTables(view.report),
    };
  }
  return {
    title: `Pipeline — ${view.period.label}`,
    subtitle: `Decisions and payments in ${view.period.label}; what is waiting, as of ${today}${narrowed}`,
    filenameBase: safeFilename(`pipeline-${view.period.code}`),
    tables: pipelineTables(view.report),
  };
}
