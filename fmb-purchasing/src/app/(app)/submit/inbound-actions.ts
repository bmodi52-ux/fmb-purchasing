"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions } from "@/lib/permissions";
import { ACCEPTED_TYPES, receiptContentType, storeReceiptFile } from "@/lib/receipt-storage";
import { MAX_UPLOAD_BYTES } from "@/lib/image-resize";

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

export type CapturedUploadResult = { ok: boolean; error?: string };

/**
 * A receipt photo taken while the phone had no signal, arriving now it has
 * (#47). It waits on the Submit page beside receipts emailed in, rather than
 * being read straight away: the person may be long gone from the till, and
 * reading it is a step they should see.
 */
export async function uploadCapturedReceipt(formData: FormData): Promise<CapturedUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to upload." };
  const permissions = await getUserPermissions(user);
  if (!can(permissions, "submit_expense", "submit")) return { ok: false, error: "You can't submit expenses." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No photo was sent." };
  const contentType = receiptContentType(file.name, file.type);
  if (!ACCEPTED_TYPES.has(contentType) || contentType === "message/rfc822") {
    return { ok: false, error: "Only photos or PDFs can be kept this way." };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That photo is too large to upload." };

  const takenAtRaw = String(formData.get("taken_at") ?? "");
  const takenAt = Number.isNaN(Date.parse(takenAtRaw)) ? null : new Date(takenAtRaw).toISOString();

  const admin = createAdminClient();
  const stored = await storeReceiptFile(admin, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    name: file.name || "Receipt photo.jpg",
    type: contentType,
  });
  const { error } = await admin.from("inbound_receipts").insert({
    user_id: user.id,
    source: "phone",
    content_type: contentType,
    captured_at: takenAt,
    storage_path: stored.storagePath,
    sha256: stored.sha256,
    file_name: stored.fileName,
    size_bytes: stored.sizeBytes,
  });
  // The same photo sent twice — a retry after a dropped connection — is one receipt.
  if (error && error.code !== "23505") return { ok: false, error: "The photo couldn't be saved. It's still on this phone." };
  revalidatePath("/submit");
  return { ok: true };
}
