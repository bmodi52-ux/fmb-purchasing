import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where one expense's money is meant to go, read at the point it is sent.
 *
 * 0037 made a vendor's account a row with a life of its own — pending while it
 * is only something a submitter read off an invoice, approved once whoever
 * makes the transfer has confirmed it. But the only place any of that was ever
 * shown was the vendor page. Payments and the expense itself displayed the
 * vendor's name and nothing about the account, so an expense whose payee was
 * an unconfirmed proposal looked exactly like one paying an account the
 * Treasurer set up years ago.
 *
 * That is the wrong place for the information to be missing. A changed BSB on
 * an invoice is the classic payment fraud, and the moment the question matters
 * is the moment somebody is about to transfer the money.
 */

export type AccountStatus = "pending" | "approved" | "superseded";

export type PaymentInstruction = {
  expenseId: string;
  payeeId: string;
  displayName: string;
  /**
   * Null for a viewer without payments:mark_paid — the trust boundary 0027
   * drew. An unused field in a payload is still a disclosure, so the numbers
   * do not leave the server for anyone else.
   */
  bankAccountName: string | null;
  bsb: string | null;
  accountNumber: string | null;
  /** Whether this account has been confirmed by anyone who pays. */
  status: AccountStatus;
  /** The vendor whose page confirms it, when the account belongs to one. */
  vendorId: string | null;
  /**
   * The approved account this one disagrees with, when it is a proposal and
   * the vendor already had an account on file. Null when the vendor had none,
   * which is a different thing entirely: nothing is being contradicted, the
   * details are simply new.
   */
  disagreesWith: { bsb: string | null; accountNumber: string | null } | null;
};

type PayeeRow = {
  id: string;
  display_name: string;
  vendor_id: string | null;
  status: AccountStatus;
  bank_account_name: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
};

const SELECT = "id, display_name, vendor_id, status, bank_account_name, bank_bsb, bank_account_number";

/**
 * How to pay each of these expenses, keyed by expense id.
 *
 * Batched because the Payments page asks for a whole run at once and a query
 * per row is what makes a list slow enough that people stop reading it.
 */
export async function paymentInstructions(
  admin: SupabaseClient,
  expenses: { id: string; payee_id: string | null }[],
  { canSeeBankDetails }: { canSeeBankDetails: boolean }
): Promise<Map<string, PaymentInstruction>> {
  const payeeIds = [...new Set(expenses.map((e) => e.payee_id).filter(Boolean) as string[])];
  if (payeeIds.length === 0) return new Map();

  const { data: payees } = await admin.from("payees").select(SELECT).in("id", payeeIds);
  const payeeById = new Map(((payees ?? []) as PayeeRow[]).map((p) => [p.id, p]));

  // Only proposals need the comparison, and only the vendor-linked ones can
  // have something to be compared against.
  const vendorIdsToCompare = [
    ...new Set(
      [...payeeById.values()]
        .filter((p) => p.status === "pending" && p.vendor_id)
        .map((p) => p.vendor_id as string)
    ),
  ];

  const approvedByVendor = new Map<string, PayeeRow>();
  if (vendorIdsToCompare.length > 0) {
    const { data: approved } = await admin
      .from("payees")
      .select(SELECT)
      .in("vendor_id", vendorIdsToCompare)
      .eq("status", "approved");
    for (const row of (approved ?? []) as PayeeRow[]) {
      if (row.vendor_id) approvedByVendor.set(row.vendor_id, row);
    }
  }

  const out = new Map<string, PaymentInstruction>();
  for (const expense of expenses) {
    if (!expense.payee_id) continue;
    const payee = payeeById.get(expense.payee_id);
    if (!payee) continue;

    const onFile = payee.status === "pending" && payee.vendor_id
      ? approvedByVendor.get(payee.vendor_id)
      : undefined;

    out.set(expense.id, {
      expenseId: expense.id,
      payeeId: payee.id,
      displayName: payee.display_name,
      bankAccountName: canSeeBankDetails ? payee.bank_account_name : null,
      bsb: canSeeBankDetails ? payee.bank_bsb : null,
      accountNumber: canSeeBankDetails ? payee.bank_account_number : null,
      status: payee.status,
      vendorId: payee.vendor_id,
      disagreesWith: onFile
        ? canSeeBankDetails
          ? { bsb: onFile.bank_bsb, accountNumber: onFile.bank_account_number }
          : { bsb: null, accountNumber: null }
        : null,
    });
  }
  return out;
}

/** The single-expense case, for the expense detail page. */
export async function paymentInstruction(
  admin: SupabaseClient,
  expense: { id: string; payee_id: string | null },
  options: { canSeeBankDetails: boolean }
): Promise<PaymentInstruction | null> {
  const found = await paymentInstructions(admin, [expense], options);
  return found.get(expense.id) ?? null;
}

/** "082-112 · 12345678", or a dash when the viewer may not see it. */
export function formatAccount(instruction: {
  bsb: string | null;
  accountNumber: string | null;
}): string {
  const bsb = instruction.bsb
    ? instruction.bsb.replace(/\D/g, "").replace(/^(\d{3})(\d{3})$/, "$1-$2")
    : null;
  if (!bsb && !instruction.accountNumber) return "—";
  return `${bsb ?? "—"} · ${instruction.accountNumber ?? "—"}`;
}
