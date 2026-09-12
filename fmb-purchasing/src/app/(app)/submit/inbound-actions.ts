"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";

/** Takes an emailed-in receipt off the waiting list without submitting it (#49). */
export async function dismissInboundReceipt(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = String(formData.get("inbound_id") ?? "");
  if (!id) return;
  // Scoped to the person: the id alone must not be enough.
  await createAdminClient()
    .from("inbound_receipts")
    .update({ status: "dismissed", handled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "waiting");
  revalidatePath("/submit");
}
