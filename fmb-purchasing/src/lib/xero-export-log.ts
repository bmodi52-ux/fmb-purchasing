import type { XeroBillLine } from "@/lib/xero-export";

/**
 * Which bills in a Xero file went in an earlier one (0087). Pure.
 *
 * Each download records the expenses it held and at what total. Before the
 * next, the bills it would hold are compared with those records: a bill sent
 * before would import into Xero a second time, and one whose total or GST has
 * changed since needs correcting in Xero by hand — importing it again would
 * add a second bill, not fix the first.
 */

/** One bill: an expense, with its lines added up. */
export type Bill = { expenseId: string; expenseNumber: string | null; total: number; gst: number };

/** An expense as an earlier file held it. */
export type PriorBill = { expenseId: string; exportedAt: string; total: number; gst: number };

export type BillHistory = {
  /** Bills no earlier file held. */
  fresh: Bill[];
  /** Bills an earlier file held, with the latest of those files. */
  sent: (Bill & { lastExportedAt: string; changed: boolean })[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function billsOf(lines: XeroBillLine[]): Bill[] {
  const bills = new Map<string, Bill>();
  for (const l of lines) {
    const bill = bills.get(l.expenseId) ?? { expenseId: l.expenseId, expenseNumber: l.expenseNumber, total: 0, gst: 0 };
    bill.total = cents(bill.total + l.lineTotal);
    bill.gst = cents(bill.gst + l.gst);
    bills.set(l.expenseId, bill);
  }
  return [...bills.values()];
}

export function billHistory(bills: Bill[], prior: PriorBill[]): BillHistory {
  const latest = new Map<string, PriorBill>();
  for (const p of prior) {
    const seen = latest.get(p.expenseId);
    if (!seen || p.exportedAt > seen.exportedAt) latest.set(p.expenseId, p);
  }
  const fresh: Bill[] = [];
  const sent: BillHistory["sent"] = [];
  for (const b of bills) {
    const p = latest.get(b.expenseId);
    if (!p) fresh.push(b);
    else
      sent.push({
        ...b,
        lastExportedAt: p.exportedAt,
        changed: Math.abs(cents(p.total) - b.total) >= 0.01 || Math.abs(cents(p.gst) - b.gst) >= 0.01,
      });
  }
  return { fresh, sent };
}

/** The lines of the bills to include: every bill, or only those no earlier file held. */
export function linesToExport(lines: XeroBillLine[], history: BillHistory, newOnly: boolean): XeroBillLine[] {
  if (!newOnly) return lines;
  const fresh = new Set(history.fresh.map((b) => b.expenseId));
  return lines.filter((l) => fresh.has(l.expenseId));
}
