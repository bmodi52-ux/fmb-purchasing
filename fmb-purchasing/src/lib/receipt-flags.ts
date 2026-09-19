import { claimVsReceipt, round2, totalChangedFromScan } from "@/lib/expense-money";

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export type ReceiptFlagLine = {
  description: string;
  lineTotal: number;
  notOnReceipt: boolean;
  notOnReceiptNote: string | null;
};

/**
 * What an approver should know about how a claim stands against its receipt
 * (#51): money claimed that the receipt doesn't show, a scanned total that was
 * changed, and any difference nobody explained. Each comes with the reason
 * the submitter gave, which is the point — the approver decides, knowing.
 *
 * Expenses from before 0060 have no receipt total and raise nothing here.
 */
export function receiptFlags(expense: {
  receiptTotal: number | null;
  receiptTotalScanned: number | null;
  receiptTotalNote: string | null;
  lines: ReceiptFlagLine[];
}): { label: string; serious: boolean }[] {
  if (expense.receiptTotal == null) return [];
  const flags: { label: string; serious: boolean }[] = [];

  const off = expense.lines.filter((l) => l.notOnReceipt);
  if (off.length > 0) {
    const sum = round2(off.reduce((s, l) => s + l.lineTotal, 0));
    const which = off.map((l) => (l.notOnReceiptNote ? `${l.description} (${l.notOnReceiptNote})` : l.description));
    flags.push({ label: `${money(sum)} of this claim isn't on the receipt: ${which.join("; ")}`, serious: true });
  }

  if (totalChangedFromScan(expense.receiptTotal, expense.receiptTotalScanned)) {
    flags.push({
      label:
        `Receipt total read as ${money(expense.receiptTotalScanned!)}, changed to ${money(expense.receiptTotal)}` +
        (expense.receiptTotalNote ? ` — ${expense.receiptTotalNote}` : ""),
      serious: true,
    });
  }

  const { unexplained } = claimVsReceipt(
    expense.lines.map((l) => ({ kind: "goods", lineTotal: l.lineTotal, gstApplicable: false, notOnReceipt: l.notOnReceipt })),
    expense.receiptTotal
  );
  if (unexplained !== 0) {
    const onReceipt = round2(expense.receiptTotal - unexplained);
    flags.push({
      label: `Unexplained difference of ${money(Math.abs(unexplained))}: the receipt says ${money(expense.receiptTotal)}, the lines on it come to ${money(onReceipt)}`,
      serious: true,
    });
  }

  return flags;
}
