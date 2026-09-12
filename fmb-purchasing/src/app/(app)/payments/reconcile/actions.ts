"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { matchStatement, parseStatementCsv, type RecordedPayment, type StatementLine } from "@/lib/bank-statement";
import { addDays } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { reportError } from "@/lib/errors";

export type ReconcileMatch = {
  key: string;
  payeeName: string;
  paymentDate: string;
  amountCents: number;
  reference: string | null;
  statementDate: string;
  statementText: string;
  byReference: boolean;
};

export type ReconcileResult =
  | {
      ok: true;
      matches: ReconcileMatch[];
      unmatchedPayments: { key: string; payeeName: string; paymentDate: string; amountCents: number; reference: string | null }[];
      unmatchedLines: StatementLine[];
      skippedRows: number;
    }
  | { ok: false; message: string };

/**
 * Paid expenses not yet seen on a statement, as the transfers they were:
 * a payment run is one transfer; an expense paid on its own is another.
 */
async function recordedPayments(admin: ReturnType<typeof createAdminClient>) {
  const since = addDays(todayIso(), -180);
  const { data } = await admin
    .from("expenses")
    .select("id, total, payment_date, payment_reference, payment_run_id, payee_id, payees ( display_name ), payment_runs ( run_number )")
    .eq("status", "paid")
    .is("bank_confirmed_on", null)
    .gte("payment_date", since);

  const groups = new Map<string, RecordedPayment & { expenseIds: string[] }>();
  for (const e of data ?? []) {
    const run = e.payment_runs as unknown as { run_number: string } | null;
    const key = (e.payment_run_id as string | null) ? `run:${e.payment_run_id}` : `expense:${e.id}`;
    const entry = groups.get(key) ?? {
      key,
      date: e.payment_date as string,
      amountCents: 0,
      reference: (e.payment_reference as string | null) ?? run?.run_number ?? null,
      payeeName: (e.payees as unknown as { display_name: string } | null)?.display_name ?? "—",
      expenseIds: [],
    };
    entry.amountCents += Math.round(Number(e.total) * 100);
    entry.expenseIds.push(e.id as string);
    groups.set(key, entry);
  }
  return groups;
}

/** Reads a statement and pairs its lines with payments recorded as made (#37). Writes nothing. */
export async function matchBankStatement(csv: string): Promise<ReconcileResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const { lines, skipped } = parseStatementCsv(csv);
  if (lines.length === 0) {
    return { ok: false, message: "No payments out were found in that file. Export the statement as CSV from internet banking and try again." };
  }

  const groups = await recordedPayments(createAdminClient());
  const { matches, unmatchedPayments, unmatchedLines } = matchStatement([...groups.values()], lines);

  return {
    ok: true,
    matches: matches.map((m) => ({
      key: m.payment.key,
      payeeName: m.payment.payeeName,
      paymentDate: m.payment.date,
      amountCents: m.payment.amountCents,
      reference: m.payment.reference,
      statementDate: m.line.date,
      statementText: m.line.description,
      byReference: m.byReference,
    })),
    unmatchedPayments: unmatchedPayments
      .filter((p) => p.date <= (lines.map((l) => l.date).sort().at(-1) ?? p.date))
      .map((p) => ({ key: p.key, payeeName: p.payeeName, paymentDate: p.date, amountCents: p.amountCents, reference: p.reference })),
    unmatchedLines,
    skippedRows: skipped,
  };
}

/** Records the confirmed matches: each covered expense is marked as seen on the statement. */
export async function confirmBankMatches(
  confirmed: { key: string; statementDate: string; statementText: string }[]
): Promise<{ confirmed: number }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const admin = createAdminClient();
  const groups = await recordedPayments(admin);
  let count = 0;
  for (const c of confirmed) {
    const group = groups.get(c.key);
    if (!group) continue;
    const { error } = await admin
      .from("expenses")
      .update({
        bank_confirmed_on: c.statementDate,
        bank_confirmed_by: user.id,
        bank_statement_text: c.statementText.slice(0, 500),
      })
      .in("id", group.expenseIds)
      .is("bank_confirmed_on", null);
    if (error) {
      await reportError({ source: "bank-reconcile", error: error.message, userId: user.id });
      throw new Error("The matches could not all be recorded. Try again.");
    }
    count += group.expenseIds.length;
  }
  revalidatePath("/payments/reconcile");
  revalidatePath("/expenses/[id]", "page");
  return { confirmed: count };
}
