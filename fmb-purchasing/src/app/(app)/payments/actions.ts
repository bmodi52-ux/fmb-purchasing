"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpensePaid } from "@/lib/expense-notifications";
import { reportError } from "@/lib/errors";
import { after } from "next/server";
import { sendRemittanceAdvice } from "@/lib/remittance";
import { getSetting } from "@/lib/app-settings";
import { buildAbaFile, checkPayment, checkSettings, type AbaPayment } from "@/lib/aba";
import { paymentInstructions } from "@/lib/payment-instruction";
import { todayIso } from "@/lib/periods-data";

type PaidExpense = {
  run_id: string | null;
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
  payee_id: string | null;
};

function revalidateAll() {
  revalidatePath("/payments");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidatePath("/expenses/[id]", "page");
  revalidateReports();
}

/**
 * Records one bank transfer against every expense it settles.
 *
 * One email arriving today headed "Please pay Burhanuddin Modi directly
 * $1,819.21" carries six receipts and one transfer; after cutover that is six
 * expenses the Treasurer settles together. When they share a payee, a
 * payment_runs row (0029) records the transfer itself, and each expense keeps
 * its own date and reference stamped from it.
 *
 * One database function (0042): the run, the six status changes and the six
 * history rows are written together or not at all. As separate writes, a
 * failure part-way left an empty run in the ledger, or expenses marked paid
 * with no record of who paid them — and the page said it had worked.
 */
async function pay(
  userId: string,
  expenseIds: string[],
  paymentDate: string,
  paymentReference: string | null,
  note: string | null
): Promise<{ runId: string | null; paidCount: number }> {
  if (expenseIds.length === 0 || !paymentDate) return { runId: null, paidCount: 0 };

  const { data, error } = await createAdminClient().rpc("pay_expenses", {
    p_expense_ids: expenseIds,
    p_actor: userId,
    p_payment_date: paymentDate,
    p_payment_reference: paymentReference,
    p_note: note,
  });

  if (error) {
    await reportError({
      source: "expense-payment",
      error: error.message,
      detail: `${expenseIds.length} expense(s) on ${paymentDate}: ${expenseIds.join(", ")}`,
      userId,
    });
    throw new Error("The payment could not be recorded, and nothing was changed. Try again.");
  }

  const paid = (data ?? []) as PaidExpense[];
  await Promise.all(paid.map((e) => notifyExpensePaid(e, paymentReference)));
  // What the transfer covered, to whoever was paid (#37) — after the response.
  const admin = createAdminClient();
  after(() => sendRemittanceAdvice(admin, paid, paymentDate, paymentReference));
  return { runId: paid[0]?.run_id ?? null, paidCount: paid.length };
}

/* ------------------------------------------------------------------ */
/* Bank file — #37                                                     */
/* ------------------------------------------------------------------ */

export type BankFileResult =
  | { ok: true; filename: string; content: string; payments: number; totalCents: number; skipped: { label: string; reason: string }[] }
  | { ok: false; message: string };

/**
 * A batch payment (ABA) file for the selected approved expenses, one transfer
 * per payee. Does not mark anything paid: the file goes to the bank first, and
 * Mark paid follows once the bank has accepted it.
 *
 * Left out, and listed: expenses with no payee, payees with no bank details,
 * and accounts nobody who pays has confirmed — the file must never be the
 * route by which an unconfirmed BSB gets paid.
 */
export async function buildBankFile(expenseIds: string[]): Promise<BankFileResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");
  if (expenseIds.length === 0) return { ok: false, message: "Select the expenses to pay first." };

  const admin = createAdminClient();
  const settings = await getSetting(admin, "aba");
  const settingsProblem = checkSettings(settings);
  if (settingsProblem) return { ok: false, message: `Bank file settings aren't complete: ${settingsProblem} (App settings → Bank file).` };

  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_name_raw, total, payee_id")
    .in("id", expenseIds)
    .eq("status", "approved");

  const instructions = await paymentInstructions(admin, expenses ?? [], { canSeeBankDetails: true });
  const skipped: { label: string; reason: string }[] = [];
  const byPayee = new Map<string, { name: string; bsb: string; account: string; cents: number; numbers: string[] }>();

  for (const e of expenses ?? []) {
    const label = `${e.expense_number ?? "Expense"} · ${e.vendor_name_raw ?? ""}`.trim();
    const i = instructions.get(e.id as string);
    if (!i) {
      skipped.push({ label, reason: "No payee chosen" });
      continue;
    }
    if (i.status !== "approved") {
      skipped.push({ label, reason: "Bank account not confirmed" });
      continue;
    }
    if (!i.bsb || !i.accountNumber) {
      skipped.push({ label, reason: "No bank details on file" });
      continue;
    }
    const entry = byPayee.get(i.payeeId) ?? {
      name: i.bankAccountName || i.displayName,
      bsb: i.bsb,
      account: i.accountNumber,
      cents: 0,
      numbers: [],
    };
    entry.cents += Math.round(Number(e.total) * 100);
    if (e.expense_number) entry.numbers.push(e.expense_number as string);
    byPayee.set(i.payeeId, entry);
  }

  const payments: AbaPayment[] = [...byPayee.values()].map((p) => ({
    bsb: p.bsb,
    accountNumber: p.account,
    accountName: p.name,
    amountCents: p.cents,
    reference: p.numbers.length === 1 ? `FMB ${p.numbers[0]}` : `FMB ${p.numbers[0] ?? ""} +${Math.max(0, p.numbers.length - 1)}`,
  }));

  for (const p of payments) {
    const problem = checkPayment(p);
    if (problem) return { ok: false, message: `${p.accountName}: ${problem}` };
  }
  if (payments.length === 0) {
    const reasons = [...new Set(skipped.map((s) => s.reason.toLowerCase()))].join(", ");
    return { ok: false, message: `None of the selected expenses can go in a bank file (${reasons}).` };
  }

  const today = todayIso();
  return {
    ok: true,
    filename: `fmb-payments-${today}.aba`,
    content: buildAbaFile(settings, payments, today),
    payments: payments.length,
    totalCents: payments.reduce((s, p) => s + p.amountCents, 0),
    skipped,
  };
}

export async function markExpensePaid(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const paymentReference = String(formData.get("payment_reference") ?? "").trim() || null;
  const paymentDate = String(formData.get("payment_date") ?? "").trim() || null;
  if (!expenseId || !paymentDate) return;

  await pay(user.id, [expenseId], paymentDate, paymentReference, null);
  revalidateAll();
}

/** Marks all selected expenses paid on the same date, with an optional shared reference. */
export async function bulkMarkPaid(
  expenseIds: string[],
  paymentDate: string,
  paymentReference: string | null,
  note?: string | null
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");
  if (expenseIds.length === 0 || !paymentDate) return;

  await pay(user.id, expenseIds, paymentDate, paymentReference, note ?? null);
  revalidateAll();
}

/**
 * Unwinds a payment recorded in error — see migrations 0029 and 0042.
 *
 * Returns the expense to approved, where it can be paid again properly, and
 * says so on the record. The reason is mandatory: this is the transition
 * someone will need explained when they audit the year.
 */
export async function reversePayment(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!expenseId || !reason) return;

  const { error } = await createAdminClient().rpc("reverse_payment", {
    p_expense_id: expenseId,
    p_actor: user.id,
    p_reason: reason,
  });

  if (error) {
    await reportError({ source: "payment-reversal", error: error.message, userId: user.id, expenseId });
    throw new Error("The payment could not be reversed, and nothing was changed. Try again.");
  }

  revalidateAll();
}
