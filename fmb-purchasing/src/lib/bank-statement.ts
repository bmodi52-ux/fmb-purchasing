/**
 * Reading a bank statement export, and finding the payments in it
 * (scratchpad #37).
 *
 * "Paid" in the app is somebody saying they made the transfer. The statement
 * is the bank saying it happened. Matching the two confirms the money actually
 * left, and shows any payment recorded that never did.
 *
 * Every Australian bank exports CSV a little differently — CommBank and ANZ
 * with no header (date, amount, description), NAB with one, Westpac with
 * separate debit and credit columns — so the columns are found by name where
 * there is a header, and assumed in the common order where there is not.
 */

export type StatementLine = {
  /** `YYYY-MM-DD`. */
  date: string;
  description: string;
  /** Money out, in whole cents, as a positive number. Deposits are left out. */
  amountCents: number;
  /** The row as it appeared, for the record. */
  raw: string;
};

/** Splits one CSV row, honouring quotes. */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** A statement date in any of the usual Australian shapes, as `YYYY-MM-DD`. */
export function parseStatementDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v))) {
    // Australian order: day first.
    [d, m, y] = [+match[1], +match[2], +match[3]];
    if (y < 100) y += 2000;
  } else if ((match = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(v))) {
    d = +match[1];
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    y = +match[3] < 100 ? +match[3] + 2000 : +match[3];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

function parseCents(value: string): number | null {
  const v = value.replace(/[$,\s]/g, "");
  if (!v) return null;
  const negative = /^\(.*\)$/.test(v) || v.startsWith("-") || /DR$/i.test(v);
  const n = Number(v.replace(/[()\-+]|CR$|DR$/gi, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

export function parseStatementCsv(text: string): { lines: StatementLine[]; skipped: number } {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows.length === 0) return { lines: [], skipped: 0 };

  const first = splitCsvRow(rows[0]).map((c) => c.toLowerCase());
  const hasHeader = !parseStatementDate(splitCsvRow(rows[0])[0] ?? "") && first.some((c) => /date/.test(c));
  const find = (...patterns: RegExp[]) => first.findIndex((c) => patterns.some((p) => p.test(c)));

  const dateCol = hasHeader ? find(/^date$/, /transaction date/, /date/) : 0;
  const descCol = hasHeader ? find(/narrative/, /transaction details/, /description/, /details/, /particulars/) : 2;
  const amountCol = hasHeader ? find(/^amount$/, /amount/) : 1;
  const debitCol = hasHeader ? find(/debit/, /withdrawal/) : -1;
  const creditCol = hasHeader ? find(/credit/, /deposit/) : -1;

  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const cells = splitCsvRow(row);
    const date = parseStatementDate(cells[dateCol] ?? "");
    let cents: number | null = null;
    if (debitCol >= 0 && (cells[debitCol] ?? "").trim()) cents = -Math.abs(parseCents(cells[debitCol]) ?? 0);
    else if (creditCol >= 0 && (cells[creditCol] ?? "").trim()) cents = Math.abs(parseCents(cells[creditCol]) ?? 0);
    else if (amountCol >= 0) cents = parseCents(cells[amountCol] ?? "");
    if (!date || cents === null) {
      skipped++;
      continue;
    }
    if (cents >= 0) continue; // money in is not a payment
    lines.push({ date, description: (descCol >= 0 ? cells[descCol] : "") ?? "", amountCents: -cents, raw: row });
  }
  return { lines, skipped };
}

export type RecordedPayment = {
  /** A payment run, or a single expense paid on its own. */
  key: string;
  date: string;
  amountCents: number;
  reference: string | null;
  payeeName: string;
};

export type StatementMatch = { payment: RecordedPayment; line: StatementLine; byReference: boolean };

function dayNumber(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
}

/**
 * Pairs recorded payments with statement lines: the same amount, dated from a
 * few days before the recorded payment date to ten days after (transfers made
 * on a Friday clear on Monday; a payment date is sometimes entered early), and
 * a reference found in the description wins over mere closeness. Each line is
 * used once.
 */
export function matchStatement(payments: RecordedPayment[], lines: StatementLine[]) {
  const used = new Set<StatementLine>();
  const matches: StatementMatch[] = [];

  const candidates = (p: RecordedPayment) =>
    lines
      .filter((l) => !used.has(l) && l.amountCents === p.amountCents)
      .filter((l) => {
        const gap = dayNumber(l.date) - dayNumber(p.date);
        return gap >= -3 && gap <= 10;
      })
      .map((l) => {
        const ref = p.reference?.replace(/\s+/g, "").toLowerCase();
        const byReference = !!ref && ref.length >= 3 && l.description.replace(/\s+/g, "").toLowerCase().includes(ref);
        return { l, byReference, distance: Math.abs(dayNumber(l.date) - dayNumber(p.date)) };
      })
      .sort((a, b) => Number(b.byReference) - Number(a.byReference) || a.distance - b.distance);

  // Payments with a reference found in a description go first, so a
  // same-amount payment without one cannot take their line.
  const ordered = [...payments].sort((a, b) => {
    const aRef = candidates(a)[0]?.byReference ? 0 : 1;
    const bRef = candidates(b)[0]?.byReference ? 0 : 1;
    return aRef - bRef;
  });

  for (const p of ordered) {
    const best = candidates(p)[0];
    if (!best) continue;
    used.add(best.l);
    matches.push({ payment: p, line: best.l, byReference: best.byReference });
  }

  return {
    matches,
    unmatchedPayments: payments.filter((p) => !matches.some((m) => m.payment === p)),
    unmatchedLines: lines.filter((l) => !used.has(l)),
  };
}
