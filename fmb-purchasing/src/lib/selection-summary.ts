/**
 * What a selection of rows says about itself (#69).
 *
 * "3 selected" is the count; before a bank transfer the figure that matters is
 * what the three come to, and adding it up by hand in front of the Download
 * bank file button is how a wrong total gets sent. So wherever rows carrying
 * money can be selected for something, the amount stands beside the count.
 *
 * Money is added in cents and returned as a number, because a run of
 * two-decimal amounts summed as floats drifts — $0.1 + $0.2 is famously not
 * $0.3 — and the total of a hundred expenses is exactly the sort of number
 * somebody checks against a bank statement.
 */

export function sumAmounts(amounts: readonly (number | null | undefined)[]): number {
  let cents = 0;
  for (const amount of amounts) {
    if (amount == null || !Number.isFinite(amount)) continue;
    cents += Math.round(amount * 100);
  }
  return cents / 100;
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

/**
 * "3 selected · $6,327.15", or just the count when the rows carry no money —
 * a list of vendors has nothing to total, and "0 selected · $0.00" would be
 * noise rather than information.
 */
export function describeSelection(count: number, total: number | null): string {
  const selected = `${count} selected`;
  return total == null ? selected : `${selected} · ${formatMoney(total)}`;
}
