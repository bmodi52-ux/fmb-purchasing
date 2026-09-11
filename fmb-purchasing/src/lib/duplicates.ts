import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import { orFilter, pgrstValue } from "@/lib/pgrst-filter";

/**
 * Possible duplicates of expenses already in someone's queue.
 *
 * The submit form has always warned the submitter (findPossibleDuplicates in
 * submit/actions.ts) — and let them carry on. The approver and the payer, who
 * are the people who could actually stop a double payment, saw nothing. This
 * asks the same two questions for a whole page of expenses at once:
 *
 *   same file     identical bytes on another expense — the same photograph
 *   same invoice  the same vendor and invoice number on another expense
 *
 * Declined and withdrawn expenses are ignored, as they are at submission: a
 * corrected resubmission is not a double claim.
 */

export type DuplicateReason = "same-file" | "same-invoice";

export type DuplicateMatch = {
  expenseId: string;
  expenseNumber: string | null;
  status: string;
  reason: DuplicateReason;
};

type ExpenseKey = { id: string; vendor_id: string | null; invoice_number: string | null };
type AttachmentRow = { expense_id: string; sha256: string };
type OtherExpense = { id: string; expense_number: string | null; status: string; vendor_id?: string | null; invoice_number?: string | null };

/**
 * The pure half: given the page's expenses and what the database found, which
 * other expenses does each one look like? Exported for testing.
 */
export function matchDuplicates(
  expenses: ExpenseKey[],
  ownAttachments: AttachmentRow[],
  sameFileRows: (AttachmentRow & { expense: OtherExpense })[],
  sameInvoiceRows: OtherExpense[]
): Map<string, DuplicateMatch[]> {
  const out = new Map<string, DuplicateMatch[]>();
  const add = (id: string, match: DuplicateMatch) => {
    if (match.expenseId === id) return;
    const list = out.get(id) ?? [];
    // A second reason for the same pair adds nothing a person needs to read.
    if (list.some((m) => m.expenseId === match.expenseId)) return;
    list.push(match);
    out.set(id, list);
  };

  const shasByExpense = new Map<string, Set<string>>();
  for (const a of ownAttachments) {
    const set = shasByExpense.get(a.expense_id) ?? new Set();
    set.add(a.sha256);
    shasByExpense.set(a.expense_id, set);
  }

  for (const e of expenses) {
    const shas = shasByExpense.get(e.id);
    if (shas) {
      for (const row of sameFileRows) {
        if (!shas.has(row.sha256)) continue;
        add(e.id, {
          expenseId: row.expense.id,
          expenseNumber: row.expense.expense_number,
          status: row.expense.status,
          reason: "same-file",
        });
      }
    }

    const invoice = e.invoice_number?.trim().toLowerCase();
    if (e.vendor_id && invoice) {
      for (const other of sameInvoiceRows) {
        if (other.vendor_id !== e.vendor_id) continue;
        if (other.invoice_number?.trim().toLowerCase() !== invoice) continue;
        add(e.id, {
          expenseId: other.id,
          expenseNumber: other.expense_number,
          status: other.status,
          reason: "same-invoice",
        });
      }
    }
  }

  return out;
}

export async function possibleDuplicates(
  admin: SupabaseClient,
  expenses: ExpenseKey[]
): Promise<Map<string, DuplicateMatch[]>> {
  if (expenses.length === 0) return new Map();
  const ids = expenses.map((e) => e.id);

  const { data: own } = await admin
    .from("expense_attachments")
    .select("expense_id, sha256")
    .in("expense_id", ids)
    .not("sha256", "is", null);
  const ownAttachments = (own ?? []) as AttachmentRow[];
  const shas = [...new Set(ownAttachments.map((a) => a.sha256))];

  const invoiceTerms = expenses
    .filter((e) => e.vendor_id && e.invoice_number?.trim())
    .map((e) => `and(vendor_id.eq.${e.vendor_id},invoice_number.ilike.${pgrstValue(e.invoice_number!.trim())})`);

  const [{ data: sameFile }, { data: sameInvoice }] = await Promise.all([
    shas.length
      ? admin
          .from("expense_attachments")
          .select("expense_id, sha256, expenses!inner ( id, expense_number, status )")
          .in("sha256", shas)
          .not("expenses.status", "in", NOT_SPEND_FILTER)
      : Promise.resolve({ data: [] }),
    invoiceTerms.length
      ? admin
          .from("expenses")
          .select("id, expense_number, status, vendor_id, invoice_number")
          .or(orFilter(...invoiceTerms))
          .not("status", "in", NOT_SPEND_FILTER)
      : Promise.resolve({ data: [] }),
  ]);

  const sameFileRows = ((sameFile ?? []) as unknown as (AttachmentRow & { expenses: OtherExpense })[]).map((r) => ({
    expense_id: r.expense_id,
    sha256: r.sha256,
    expense: r.expenses,
  }));

  return matchDuplicates(expenses, ownAttachments, sameFileRows, (sameInvoice ?? []) as OtherExpense[]);
}

/** "Possible duplicate of E-0123", for a flag. */
export function duplicateLabel(matches: DuplicateMatch[]): string {
  const numbers = matches.map((m) => m.expenseNumber ?? "another expense");
  const shown = numbers.slice(0, 2).join(", ");
  const more = numbers.length > 2 ? ` and ${numbers.length - 2} more` : "";
  return `Possible duplicate of ${shown}${more}`;
}
