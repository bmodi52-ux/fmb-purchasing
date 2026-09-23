"use client";

import { useState } from "react";
import {
  reconcile,
  sumLines,
  sumLineGst,
  suggestedKindForDifference,
  totalChangedFromScan,
  round2,
  type MoneyLine,
} from "@/lib/expense-money";
import { SUBSTANTIVE_KINDS } from "@/lib/line-kinds";
import type { StoredLineKind } from "@/lib/line-kinds";

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** A line that is not something bought, but something charged on top of it. */
export type ChargeKind = Exclude<StoredLineKind, "goods" | "service">;

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  surcharge: "Card or service surcharge",
  delivery: "Delivery or freight",
  discount: "Discount",
  rounding: "Cash rounding",
  deposit: "Container deposit",
  // The escape hatch of migration 0026: a receipt that cannot be itemised at
  // all still records the right total, with the ambiguity stated rather than
  // hidden inside a guessed line.
  unallocated: "Not itemised",
};

/**
 * Every kind as it reads in the line-kind picker.
 *
 * Services sit at the top with goods because they are what was bought, not
 * something added to it — the distinction that keeps a cleaning invoice out
 * of the Pricelist and out of per-unit costing (migration 0035).
 */
export const LINE_KIND_LABELS: Record<StoredLineKind, string> = {
  goods: "Goods",
  service: "Service or labour",
  ...CHARGE_KIND_LABELS,
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
  autoAddedCount = 0,
  scannedTotal = null,
  totalNote = "",
  onTotalNoteChange,
}: {
  lines: MoneyLine[];
  receiptTotal: number;
  onReceiptTotalChange: (v: number) => void;
  /** GST as printed on the receipt, for comparison. Null when it printed none. */
  printedGst: number | null;
  onAddCharge: (kind: StoredLineKind, amount: number) => void;
  /** How many lines the app added itself, so the copy can say so. */
  autoAddedCount?: number;
  /**
   * The total as the scan read it (#51). While there is one, the total is
   * shown locked; changing it opens the field and asks why.
   */
  scannedTotal?: number | null;
  totalNote?: string;
  onTotalNoteChange?: (v: string) => void;
}) {
  const changed = totalChangedFromScan(receiptTotal, scannedTotal);
  const [editingTotal, setEditingTotal] = useState(false);
  const locked = scannedTotal != null && !editingTotal && !changed;
  // Services sit with goods, not with charges. Reading "Charges and discounts
  // ×1 · $450.00" on a cleaning invoice would suggest the app had misread the
  // whole thing.
  const onReceipt = lines.filter((l) => !l.notOnReceipt);
  const offReceipt = lines.filter((l) => l.notOnReceipt);
  const purchases = onReceipt.filter((l) => (SUBSTANTIVE_KINDS as readonly string[]).includes(l.kind));
  const charges = onReceipt.filter((l) => !(SUBSTANTIVE_KINDS as readonly string[]).includes(l.kind));
  const balance = reconcile(lines, receiptTotal);
  const computedGst = sumLineGst(lines);
  const gstGap = printedGst == null ? null : round2(printedGst - computedGst);
  const suggested = suggestedKindForDifference(balance.difference);

  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white/70 p-4">
      <div className="flex flex-col gap-1.5 tabular-nums text-sm">
        <Row label="Line items" value={sumLines(purchases)} count={purchases.length} />
        {charges.length > 0 && (
          <Row label="Charges and discounts" value={sumLines(charges)} count={charges.length} />
        )}

        <div className="mt-1 flex items-center justify-between gap-3 border-t border-ink/15 pt-2">
          <label htmlFor="receipt-total" className="font-sans text-ink/70">
            Receipt total
            <span className="ml-1.5 text-xs text-ink/45">as printed</span>
          </label>
          {locked ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingTotal(true)}
                className="font-sans text-xs text-ink/50 underline hover:text-ink"
              >
                Change
              </button>
              <span id="receipt-total" className="w-32 px-2 py-1 text-right text-base font-semibold tabular-figures">
                {money(receiptTotal)}
              </span>
            </span>
          ) : (
            <input
              id="receipt-total"
              type="number"
              step="0.01"
              value={receiptTotal}
              onChange={(e) => onReceiptTotalChange(Number(e.target.value))}
              className="w-32 rounded border border-ink/20 bg-white px-2 py-1 text-right text-base font-semibold tabular-figures"
            />
          )}
        </div>
        {scannedTotal != null && (editingTotal || changed) && (
          <div className="flex flex-col gap-1 font-sans text-xs text-ink/60">
            <span>
              Read from the receipt as <span className="font-medium text-ink/80">{money(scannedTotal)}</span>.
              {changed ? " The approver will see both, with your reason." : " Only change it if the scan misread it."}
              {changed && (
                <button
                  type="button"
                  onClick={() => {
                    onReceiptTotalChange(scannedTotal);
                    onTotalNoteChange?.("");
                    setEditingTotal(false);
                  }}
                  className="ml-2 underline hover:text-ink"
                >
                  Put back
                </button>
              )}
            </span>
            {changed && (
              <input
                value={totalNote}
                onChange={(e) => onTotalNoteChange?.(e.target.value)}
                placeholder="Why it's different — e.g. the scan misread 8 as 3"
                aria-label="Why the receipt total was changed"
                className="w-full rounded border border-ink/20 bg-white px-2 py-1 text-sm text-ink"
              />
            )}
          </div>
        )}
        {offReceipt.length > 0 && (
          <Row label="Claimed on top, not on this receipt" value={sumLines(offReceipt)} count={offReceipt.length} />
        )}

        <div
          className={`-mx-4 -mb-4 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-b-lg px-4 py-2.5 ${
            balance.balanced ? "bg-palm/10" : "bg-gold/15"
          }`}
        >
          <span className="font-sans text-sm text-ink/75">
            {balance.balanced ? (
              autoAddedCount > 0 ? (
                <>
                  Everything is accounted for.{" "}
                  <span className="text-ink/55">
                    {autoAddedCount === 1 ? "One line was" : `${autoAddedCount} lines were`} added
                    automatically to match the receipt total — worth a glance.
                  </span>
                </>
              ) : offReceipt.length > 0 ? (
                <>
                  Everything on the receipt is accounted for.{" "}
                  <span className="text-ink/55">
                    {money(sumLines(offReceipt))} more is claimed that isn&rsquo;t on it — the approver will see why.
                  </span>
                </>
              ) : (
                <>Everything on the receipt is accounted for.</>
              )
            ) : balance.difference > 0 ? (
              <>
                <span className="font-semibold text-ink">{money(balance.difference)}</span> of the
                receipt total isn&rsquo;t on a line yet.
              </>
            ) : (
              <>
                The lines come to{" "}
                <span className="font-semibold text-ink">{money(-balance.difference)}</span> more
                than the receipt total.{" "}
                <span className="text-ink/55">
                  If a line isn&rsquo;t on this receipt, tick &ldquo;Not on this receipt&rdquo; on it and say why.
                </span>
              </>
            )}
          </span>

          {!balance.balanced && (
            <button
              type="button"
              onClick={() => onAddCharge(suggested, round2(balance.difference))}
              className="shrink-0 rounded-md border border-gold-deep/40 bg-white px-3 py-1.5 font-sans text-xs font-medium text-gold-deep hover:bg-gold/10"
            >
              Add as {CHARGE_KIND_LABELS[suggested as ChargeKind].toLowerCase()}
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1.5 border-t border-ink/10 pt-3 tabular-nums text-sm">
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
