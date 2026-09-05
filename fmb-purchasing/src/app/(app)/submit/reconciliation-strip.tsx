"use client";

import {
  reconcile,
  sumLines,
  sumLineGst,
  suggestedKindForDifference,
  round2,
  type MoneyLine,
} from "@/lib/expense-money";
import type { LineKind } from "@/lib/receipt-extraction";

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export const CHARGE_KIND_LABELS: Record<Exclude<LineKind, "goods">, string> = {
  surcharge: "Card or service surcharge",
  delivery: "Delivery or freight",
  discount: "Discount",
  rounding: "Cash rounding",
  deposit: "Container deposit",
};

/**
 * The arithmetic of the receipt, always on screen.
 *
 * The form used to compute the total by summing the line items, which meant
 * anything the receipt charged without itemising vanished without trace: an
 * Aldi card surcharge of $0.56, a Radhe discount of -$9.20, freight, cash
 * rounding. The recorded total then disagreed with the tax invoice and with
 * the bank transfer, and the person who paid was reimbursed short.
 *
 * So the total is now typed in from the receipt, and this shows whether the
 * lines account for it. Deliberately not an error message: it is a running
 * subtraction that has to reach zero, shown from the moment the form opens
 * rather than sprung at submit time — and the way to resolve it is one tap,
 * because the answer is nearly always "that was the surcharge".
 */
export function ReconciliationStrip({
  lines,
  receiptTotal,
  onReceiptTotalChange,
  printedGst,
  onAddCharge,
}: {
  lines: MoneyLine[];
  receiptTotal: number;
  onReceiptTotalChange: (v: number) => void;
  /** GST as printed on the receipt, for comparison. Null when it printed none. */
  printedGst: number | null;
  onAddCharge: (kind: LineKind, amount: number) => void;
}) {
  const goods = lines.filter((l) => l.kind === "goods");
  const charges = lines.filter((l) => l.kind !== "goods");
  const balance = reconcile(lines, receiptTotal);
  const computedGst = sumLineGst(lines);
  const gstGap = printedGst == null ? null : round2(printedGst - computedGst);
  const suggested = suggestedKindForDifference(balance.difference);

  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white/70 p-4">
      <div className="flex flex-col gap-1.5 font-mono text-sm">
        <Row label="Line items" value={sumLines(goods)} count={goods.length} />
        {charges.length > 0 && (
          <Row label="Charges and discounts" value={sumLines(charges)} count={charges.length} />
        )}

        <div className="mt-1 flex items-center justify-between gap-3 border-t border-ink/15 pt-2">
          <label htmlFor="receipt-total" className="font-sans text-ink/70">
            Receipt total
            <span className="ml-1.5 text-xs text-ink/45">as printed</span>
          </label>
          <input
            id="receipt-total"
            type="number"
            step="0.01"
            value={receiptTotal}
            onChange={(e) => onReceiptTotalChange(Number(e.target.value))}
            className="w-32 rounded border border-ink/20 bg-white px-2 py-1 text-right text-base font-semibold tabular-figures"
          />
        </div>

        <div
          className={`-mx-4 -mb-4 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-b-lg px-4 py-2.5 ${
            balance.balanced ? "bg-palm/10" : "bg-gold/15"
          }`}
        >
          <span className="font-sans text-sm text-ink/75">
            {balance.balanced ? (
              <>Everything on the receipt is accounted for.</>
            ) : balance.difference > 0 ? (
              <>
                <span className="font-semibold text-ink">{money(balance.difference)}</span> of the
                receipt total isn&rsquo;t on a line yet.
              </>
            ) : (
              <>
                The lines come to{" "}
                <span className="font-semibold text-ink">{money(-balance.difference)}</span> more
                than the receipt total.
              </>
            )}
          </span>

          {!balance.balanced && (
            <button
              type="button"
              onClick={() => onAddCharge(suggested, round2(balance.difference))}
              className="shrink-0 rounded-md border border-gold-deep/40 bg-white px-3 py-1.5 font-sans text-xs font-medium text-gold-deep hover:bg-gold/10"
            >
              Add as {CHARGE_KIND_LABELS[suggested as Exclude<LineKind, "goods">].toLowerCase()}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5 border-t border-ink/10 pt-3 font-mono text-sm">
        <Row label="GST from the lines" value={computedGst} />
        {gstGap !== null && gstGap !== 0 && (
          <p className="font-sans text-xs leading-relaxed text-ink/60">
            The receipt prints GST of <span className="font-medium text-ink/80">{money(printedGst!)}</span>,
            which is {money(Math.abs(gstGap))}{" "}
            {gstGap > 0 ? "more than" : "less than"} the lines add up to. Check which lines are
            ticked as GST — most fresh food carries none.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, count }: { label: string; value: number; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-sans text-ink/60">
        {label}
        {count !== undefined && <span className="ml-1.5 text-xs text-ink/40">×{count}</span>}
      </span>
      <span className="tabular-figures text-ink/80">{money(value)}</span>
    </div>
  );
}
