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
 * Reads expense_attachments (0028), falling back to the deprecated
 * expenses.receipt_file_path for anything recorded before it. Both are live
 * until every reader has moved and the column can be dropped.
 */
export async function getExpenseAttachments(expenseId: string): Promise<SignedAttachment[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select("submitted_by, receipt_file_path")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense) return [];

  if (!(await canViewExpense(user, expense.submitted_by))) return [];

  const { data: rows } = await admin
    .from("expense_attachments")
    .select("storage_path, file_name, content_type")
    .eq("expense_id", expenseId)
    .order("sort_order");

  const files =
    rows && rows.length > 0
      ? rows
      : expense.receipt_file_path
        ? [
            {
              storage_path: expense.receipt_file_path as string,
              file_name: "Receipt",
              content_type: expense.receipt_file_path.toLowerCase().endsWith(".pdf")
                ? "application/pdf"
                : "image/jpeg",
            },
          ]
        : [];

  if (files.length === 0) return [];

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
