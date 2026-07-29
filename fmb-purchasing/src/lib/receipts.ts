"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewExpense } from "@/lib/expense-access";

/**
 * Signs a receipt URL on demand rather than eagerly for every row on a list
 * page — with many expenses, pre-signing every row's receipt would repeat
 * the kind of per-request Supabase round-trip storm fixed earlier for
 * getCurrentUser/getUserPermissions.
 */
export async function getExpenseReceiptUrl(expenseId: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select("receipt_file_path, submitted_by")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense?.receipt_file_path) return null;

  if (!(await canViewExpense(user, expense.submitted_by))) return null;

  const { data } = await admin.storage.from("receipts").createSignedUrl(expense.receipt_file_path, 3600);
  return data?.signedUrl ?? null;
}
