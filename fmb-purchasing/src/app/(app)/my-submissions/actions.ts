"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { RECEIPTS_BUCKET } from "@/lib/receipt-storage";
import { reportError } from "@/lib/errors";

/**
 * Deletes the expenses among these that the user may actually delete — their
 * own, still awaiting a decision — and silently skips the rest.
 *
 * Set-based rather than a loop. Deleting forty expenses used to be forty
 * sequential passes of three statements each, all the way to Sydney; this is
 * four queries regardless of how many are selected.
 */
async function deleteExpenses(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  expenseIds: string[]
): Promise<void> {
  if (expenseIds.length === 0) return;

  const { data: eligible } = await admin
    .from("expenses")
    .select("id")
    .in("id", expenseIds)
    .eq("submitted_by", userId)
    .eq("status", "submitted");

  const ids = (eligible ?? []).map((e) => e.id as string);
  if (ids.length === 0) return;

  // The files first, while the rows that name them still exist.
  //
  // Deleting an expense used to leave its receipt in the bucket for ever:
  // nothing else referenced the object, so it could not be found again, let
  // alone removed. Content-addressed storage (0028) makes this safe to do
  // eagerly — an object is only unlinked once no surviving attachment names
  // it, which matters because two submissions of the same photograph share a
  // path.
  const { data: attachments } = await admin
    .from("expense_attachments")
    .select("storage_path")
    .in("expense_id", ids);

  const paths = [...new Set((attachments ?? []).map((a) => a.storage_path as string))];
  if (paths.length > 0) {
    const { data: stillReferenced } = await admin
      .from("expense_attachments")
      .select("storage_path")
      .in("storage_path", paths)
      .not("expense_id", "in", `(${ids.join(",")})`);

    const keep = new Set((stillReferenced ?? []).map((a) => a.storage_path as string));
    const orphaned = paths.filter((p) => !keep.has(p));

    if (orphaned.length > 0) {
      const { error } = await admin.storage.from(RECEIPTS_BUCKET).remove(orphaned);
      // A storage failure must not block the delete the person asked for; the
      // worst case is the orphan this was meant to prevent, which is where we
      // started, and now it is at least recorded.
      if (error) {
        await reportError({
          source: "receipt-cleanup",
          error: error.message,
          detail: `${orphaned.length} file(s) left behind`,
          userId,
        });
      }
    }
  }

  // expense_line_items and expense_attachments both cascade from expenses;
  // expense_status_history does not, so it goes first.
  await admin.from("expense_status_history").delete().in("expense_id", ids);
  await admin.from("expenses").delete().in("id", ids);
}

export async function deleteExpense(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Every sibling action checks this; this one did not, so someone whose
  // edit_own grant had been revoked could still delete.
  await requirePermission(user, "submit_expense", "edit_own");

  const expenseId = String(formData.get("expense_id"));
  if (!expenseId) return;

  await deleteExpenses(createAdminClient(), user.id, [expenseId]);
  revalidatePath("/my-submissions");
  revalidateReports();
}

/** Deletes any selected expenses that are still eligible (own, still "submitted"); silently skips the rest. */
export async function bulkDeleteExpenses(expenseIds: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");
  if (expenseIds.length === 0) return;

  await deleteExpenses(createAdminClient(), user.id, expenseIds);
  revalidatePath("/my-submissions");
  revalidateReports();
}
