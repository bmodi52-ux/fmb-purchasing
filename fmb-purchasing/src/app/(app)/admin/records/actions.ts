"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

/** Records that a restore was rehearsed, and how it went (#45). */
export async function recordRestoreRehearsal(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");

  const day = String(formData.get("rehearsed_on") ?? "");
  const what = String(formData.get("what") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Give the date the restore was rehearsed.");
  if (!["database", "receipt_files", "both"].includes(what)) throw new Error("Say what was restored.");

  const { error } = await createAdminClient()
    .from("restore_rehearsals")
    .insert({
      rehearsed_on: day,
      what,
      succeeded: formData.get("succeeded") === "yes",
      notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null,
      recorded_by: user.id,
    });
  if (error) throw new Error("The rehearsal could not be recorded. Try again.");
  revalidatePath("/admin/records");
}
