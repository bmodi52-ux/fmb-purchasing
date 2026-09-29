import type { SupabaseClient } from "@supabase/supabase-js";
import { monthCalendarFor, parsePeriod, type Period } from "@/lib/periods";
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
  { key: "waiting", label: "Awaiting payment" },
  { key: "pipeline", label: "Pipeline" },
];

export type MoneyOutView =
  | { section: "paid"; period: Period; report: PaymentsMade }
  | { section: "waiting"; report: Waiting }
  | { section: "pipeline"; period: Period; report: Pipeline };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function moneyOutSection(params: Params): MoneyOutSection {
  const s = one(params.section);
  return MONEY_OUT_SECTIONS.some((x) => x.key === s) ? (s as MoneyOutSection) : "paid";
}

export async function loadMoneyOutView(admin: SupabaseClient, params: Params, today: string): Promise<MoneyOutView> {
  const section = moneyOutSection(params);
  if (section === "waiting") {
    return { section, report: waiting(await loadAwaitingPayment(admin), (e) => e.decidedOn, today) };
  }

  const period = parsePeriod(one(params.period), today);
  const calendar = monthCalendarFor(period);
  if (section === "paid") {
    return { section, period, report: paymentsMade(await loadPaidIn(admin, period), calendar) };
  }

  const [submitted, approved, decidedInPeriod, paidInPeriod] = await Promise.all([
    loadAwaitingReview(admin),
    loadAwaitingPayment(admin),
    loadDecidedIn(admin, period),
    loadPaidIn(admin, period),
  ]);
  return { section, period, report: pipeline({ submitted, approved, decidedInPeriod, paidInPeriod }, today, calendar) };
}

export function moneyOutDocument(view: MoneyOutView, today: string): ReportDocument {
  if (view.section === "waiting") {
    return {
      title: "Awaiting payment",
      subtitle: `Approved and not yet paid, as of ${today} · days counted from approval`,
      filenameBase: safeFilename(`awaiting-payment-${today}`),
      tables: waitingTables("Awaiting payment", "Approved", view.report),
    };
  }
  if (view.section === "paid") {
    return {
      title: `Payments made — ${view.period.label}`,
      subtitle: `${view.period.label} · by payment date · payee names only, no bank details`,
      filenameBase: safeFilename(`payments-made-${view.period.code}`),
      tables: paymentsMadeTables(view.report),
    };
  }
  return {
    title: `Pipeline — ${view.period.label}`,
    subtitle: `Decisions and payments in ${view.period.label}; what is waiting, as of ${today}`,
    filenameBase: safeFilename(`pipeline-${view.period.code}`),
    tables: pipelineTables(view.report),
  };
}
