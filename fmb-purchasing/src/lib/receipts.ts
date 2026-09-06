"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewExpense } from "@/lib/expense-access";
import { RECEIPTS_BUCKET } from "@/lib/receipt-storage";

export type SignedAttachment = {
  url: string;
  fileName: string;
  contentType: string;
};

/**
 * An expense's files, signed on demand.
 *
 * Signed here rather than eagerly for every row on a list page: with many
 * expenses, pre-signing each one's receipt would repeat the kind of
 * per-request Supabase round-trip storm fixed earlier for getCurrentUser and
 * getUserPermissions.
 *
 * expense_attachments is the only source since migration 0033 dropped
 * expenses.receipt_file_path. Everything that column held was carried across
 * before it went — twice, once in 0028 and again in 0033 for anything written
 * in between.
 */
export async function getExpenseAttachments(expenseId: string): Promise<SignedAttachment[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select("submitted_by")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense) return [];

  if (!(await canViewExpense(user, expense.submitted_by))) return [];

  const { data: files } = await admin
    .from("expense_attachments")
    .select("storage_path, file_name, content_type")
    .eq("expense_id", expenseId)
    .order("sort_order");

  if (!files || files.length === 0) return [];

  // One call for all of them, rather than one round trip per file.
  const { data: signed } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrls(files.map((f) => f.storage_path), 3600);

  return (signed ?? [])
    .map((s, i) => {
      if (!s.signedUrl) return null;
      return {
        url: s.signedUrl,
        fileName: files[i]!.file_name,
        contentType: files[i]!.content_type,
      };
    })
    .filter((a): a is SignedAttachment => a !== null);
}
