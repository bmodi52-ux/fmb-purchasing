/**
 * ABA ("Cemtex" / Direct Entry) batch payment files (scratchpad #37).
 *
 * The file Australian banks accept for a batch of transfers: one line per
 * payment, fixed-width at 120 characters, between a header naming who is
 * paying and a footer that totals it. Uploading one replaces typing each
 * transfer into internet banking — and the bank's own approval of the upload
 * stays in charge of actually moving the money.
 *
 *   0  descriptive record   bank, FMB's name and user ID, processing date
 *   1  detail record        one per payee: BSB, account, amount, name, reference
 *   7  file total           net, credit and debit totals, and the record count
 *
 * Some banks also want a balancing debit record — a final type-1 line taking
 * the total out of FMB's own account — and some reject one, so it is a setting.
 *
 * Pure: records in, text out, every field tested for width.
 */

export type AbaSettings = {
  /** The bank's three-letter code, e.g. NAB, CBA, WBC, ANZ. */
  bankAbbreviation: string;
  /** FMB's name as the bank has it. */
  userName: string;
  /** The six-digit user identification number the bank issues for batch payments. */
  userId: string;
  /** FMB's own account, for the trace record and any balancing line. */
  bsb: string;
  accountNumber: string;
  /** What each payee sees as the sender, 16 characters. */
  remitterName: string;
  /** Printed on the batch, 12 characters, e.g. PAYMENTS. */
  description: string;
  /** Add a balancing debit record. */
  balancing: boolean;
};

export type AbaPayment = {
  bsb: string;
  accountNumber: string;
  accountName: string;
  /** Whole cents. */
  amountCents: number;
  /** What the payee sees on their statement, 18 characters. */
  reference: string;
};

const CREDIT = "50";
const DEBIT = "13";

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Letters, digits and the punctuation banks accept, upper-cased. */
function clean(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9 &'()*+,\-./]/g, " ")
    .toUpperCase();
}

function left(value: string, width: number): string {
  return clean(value).slice(0, width).padEnd(width, " ");
}

function right(value: string, width: number, fill: string): string {
  return value.slice(-width).padStart(width, fill);
}

export function formatBsb(bsb: string): string {
  const d = digits(bsb);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}`;
}

export type AbaProblem = { index: number; problem: string };

/** What would make a payment unusable in the file, before anyone uploads it. */
export function checkPayment(p: AbaPayment): string | null {
  if (digits(p.bsb).length !== 6) return "The BSB needs six digits.";
  const account = digits(p.accountNumber);
  if (account.length < 1 || account.length > 9) return "The account number must be up to nine digits.";
  if (!clean(p.accountName).trim()) return "The account name is missing.";
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) return "The amount must be more than zero.";
  if (p.amountCents > 9_999_999_999) return "The amount is too large for one line.";
  return null;
}

export function checkSettings(s: AbaSettings): string | null {
  if (!/^[A-Za-z]{3}$/.test(s.bankAbbreviation.trim())) return "The bank code must be three letters, such as NAB.";
  if (!/^\d{6}$/.test(digits(s.userId))) return "The bank's user ID number must be six digits.";
  if (!s.userName.trim()) return "FMB's name as the bank has it is missing.";
  if (digits(s.bsb).length !== 6 || !digits(s.accountNumber)) return "FMB's own BSB and account number are needed.";
  return null;
}

/** DDMMYY, from a `YYYY-MM-DD` day. */
function processingDate(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
}

function detail(
  code: string,
  bsb: string,
  account: string,
  cents: number,
  name: string,
  reference: string,
  settings: AbaSettings
): string {
  return (
    "1" +
    formatBsb(bsb) +
    right(digits(account), 9, " ") +
    " " +
    code +
    right(String(cents), 10, "0") +
    left(name, 32) +
    left(reference, 18) +
    formatBsb(settings.bsb) +
    right(digits(settings.accountNumber), 9, " ") +
    left(settings.remitterName || settings.userName, 16) +
    "00000000"
  );
}

/**
 * The file, as text with CRLF line endings. Throws on a payment or setting the
 * bank would reject — call checkPayment and checkSettings first to explain.
 */
export function buildAbaFile(settings: AbaSettings, payments: AbaPayment[], processingDay: string): string {
  const settingsProblem = checkSettings(settings);
  if (settingsProblem) throw new Error(settingsProblem);
  payments.forEach((p, i) => {
    const problem = checkPayment(p);
    if (problem) throw new Error(`Payment ${i + 1}: ${problem}`);
  });

  const header =
    "0" +
    " ".repeat(17) +
    "01" +
    left(settings.bankAbbreviation, 3) +
    " ".repeat(7) +
    left(settings.userName, 26) +
    right(digits(settings.userId), 6, "0") +
    left(settings.description || "PAYMENTS", 12) +
    processingDate(processingDay) +
    " ".repeat(40);

  const lines = payments.map((p) =>
    detail(CREDIT, p.bsb, p.accountNumber, p.amountCents, p.accountName, p.reference, settings)
  );
  const credit = payments.reduce((s, p) => s + p.amountCents, 0);
  let debit = 0;

  if (settings.balancing) {
    lines.push(
      detail(DEBIT, settings.bsb, settings.accountNumber, credit, settings.userName, settings.description || "PAYMENTS", settings)
    );
    debit = credit;
  }

  const footer =
    "7" +
    "999-999" +
    " ".repeat(12) +
    right(String(Math.abs(credit - debit)), 10, "0") +
    right(String(credit), 10, "0") +
    right(String(debit), 10, "0") +
    " ".repeat(24) +
    right(String(lines.length), 6, "0") +
    " ".repeat(40);

  return [header, ...lines, footer].join("\r\n") + "\r\n";
}
