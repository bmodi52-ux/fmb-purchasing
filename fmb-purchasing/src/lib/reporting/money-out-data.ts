import type { SupabaseClient } from "@supabase/supabase-js";
import { orgDay } from "@/lib/format";
import { addDays } from "@/lib/periods";
import { allRows, allRowsForIds } from "@/lib/supabase/all-rows";
import { vendorLabel } from "@/lib/vendor-names";
import type { DateRange } from "./ledger-rows.ts";
import { vendorKey } from "./filters.ts";
import { statusesOf } from "./measures.ts";
import type { MoneyExpense } from "./money-out.ts";

/**
 * Loading money out (money-out.ts). Uncached: these report the state of
 * things now — what is waiting, what has just been paid — and read far fewer
 * rows than the spend ledger. Payee names only: no bank details are read.
 */

type Row = {
  id: string;
  expense_number: string | null;
  status: string;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  payee_id: string | null;
  total: number | string;
  created_at: string;
  decided_at: string | null;
  payment_date: string | null;
  payment_run_id: string | null;
  payment_reference: string | null;
  bank_confirmed_on: string | null;
};

const COLUMNS =
  "id, expense_number, status, vendor_id, vendor_name_raw, payee_id, total, created_at, decided_at, payment_date, payment_run_id, payment_reference, bank_confirmed_on";

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function load(admin: SupabaseClient, where: (q: Query) => Query): Promise<MoneyExpense[]> {
  const rows = await allRows<Row>((from, to) =>
    where(admin.from("expenses").select(COLUMNS)).order("id").range(from, to)
  );

  const ids = (pick: (r: Row) => string | null) => [...new Set(rows.map(pick).filter(Boolean) as string[])];
  const [vendors, payees, runs] = await Promise.all([
    allRowsForIds<{ id: string; name: string }>(ids((r) => r.vendor_id), (slice, from, to) =>
      admin.from("vendors").select("id, name").in("id", slice).order("id").range(from, to)
    ),
    allRowsForIds<{ id: string; display_name: string }>(ids((r) => r.payee_id), (slice, from, to) =>
      admin.from("payees").select("id, display_name").in("id", slice).order("id").range(from, to)
    ),
    allRowsForIds<{ id: string; run_number: string }>(ids((r) => r.payment_run_id), (slice, from, to) =>
      admin.from("payment_runs").select("id, run_number").in("id", slice).order("id").range(from, to)
    ),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const payeeName = new Map(payees.map((p) => [p.id, p.display_name]));
  const runNumber = new Map(runs.map((r) => [r.id, r.run_number]));

  return rows.map((r) => {
    const vendor = vendorLabel(r.vendor_id ? vendorName.get(r.vendor_id) : null, r.vendor_name_raw);
    return {
      id: r.id,
      entry: r.expense_number,
      status: r.status,
      vendor,
      vendorKey: vendorKey(r.vendor_id, vendor),
      payee: (r.payee_id ? payeeName.get(r.payee_id) : null) ?? "No payee recorded",
      total: Number(r.total),
      submittedOn: orgDay(r.created_at),
      decidedOn: r.decided_at ? orgDay(r.decided_at) : null,
      paidOn: r.payment_date,
      runId: r.payment_run_id,
      runNumber: r.payment_run_id ? (runNumber.get(r.payment_run_id) ?? null) : null,
      reference: r.payment_reference,
      bankConfirmedOn: r.bank_confirmed_on,
    };
  });
}

/** Paid (measures.ts), with the payment dated in the range. */
export function loadPaidIn(admin: SupabaseClient, range: DateRange) {
  return load(admin, (q) => q.in("status", [...statusesOf("paid")]).gte("payment_date", range.start).lte("payment_date", range.end));
}

/** Outstanding (measures.ts): approved and not yet paid — now. */
export function loadAwaitingPayment(admin: SupabaseClient) {
  return load(admin, (q) => q.in("status", [...statusesOf("outstanding")]));
}

/** Awaiting review (measures.ts): submitted and not yet decided — now. */
export function loadAwaitingReview(admin: SupabaseClient) {
  return load(admin, (q) => q.in("status", [...statusesOf("awaitingReview")]));
}

/**
 * Decided (approved, paid or declined) on a Sydney day in the range. The
 * database holds the instant, so a day either side is fetched and the rest
 * trimmed by the day it fell on here.
 */
export async function loadDecidedIn(admin: SupabaseClient, range: DateRange): Promise<MoneyExpense[]> {
  const rows = await load(admin, (q) =>
    q
      .in("status", [...statusesOf("accrued"), "declined"])
      .gte("decided_at", `${addDays(range.start, -1)}T00:00:00Z`)
      .lt("decided_at", `${addDays(range.end, 2)}T00:00:00Z`)
  );
  return rows.filter((e) => e.decidedOn && e.decidedOn >= range.start && e.decidedOn <= range.end);
}
