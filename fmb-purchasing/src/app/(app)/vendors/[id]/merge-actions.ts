"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateReports } from "../../reports/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { reportError } from "@/lib/errors";

/**
 * Merging two vendors, and undoing it (#44, migration 0080). Anyone who can
 * edit vendors can do either. The work, and the record that makes undo
 * possible, is in merge_vendors and undo_vendor_merge.
 */

async function requireVendorEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "edit_master_data");
  return user;
}

export type VendorMergeState = { error: string | null };

export type VendorSearchResult = { id: string; vendorNumber: string | null; name: string; abn: string | null };

/** Vendors to merge into: not this one, and not one already merged away. */
export async function searchVendorsForMerge(query: string, excludeId: string): Promise<VendorSearchResult[]> {
  await requireVendorEdit();
  const q = query.trim().replace(/[%_,()]/g, " ");
  if (q.length < 2) return [];
  const { data } = await createAdminClient()
    .from("vendors")
    .select("id, vendor_number, name, abn")
    .is("merged_into", null)
    .neq("id", excludeId)
    .or(`name.ilike.%${q}%,vendor_number.ilike.%${q}%,abn.ilike.%${q.replace(/\s/g, "")}%`)
    .order("name")
    .limit(8);
  return (data ?? []).map((v) => ({
    id: v.id as string,
    vendorNumber: (v.vendor_number as string | null) ?? null,
    name: v.name as string,
    abn: (v.abn as string | null) ?? null,
  }));
}

function revalidateVendors(ids: string[]) {
  for (const id of ids) revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
  revalidatePath("/pricelist");
  revalidatePath("/expenses");
  revalidateReports();
}

/** Merge `from_id` into `into_id`, keeping into's details; lands on the kept vendor. */
export async function mergeVendorAction(_prev: VendorMergeState, formData: FormData): Promise<VendorMergeState> {
  const user = await requireVendorEdit();
  const fromId = String(formData.get("from_id") ?? "");
  const intoId = String(formData.get("into_id") ?? "");
  if (!fromId || !intoId) return { error: "Choose the vendor to merge into." };

  const admin = createAdminClient();
  const { data: mergeId, error } = await admin.rpc("merge_vendors", {
    p_from: fromId,
    p_into: intoId,
    p_actor: user.id,
  });
  if (error) {
    await reportError({ source: "vendor-merge", error: error.message, userId: user.id, detail: `${fromId} → ${intoId}` });
    return { error: error.message };
  }

  const { data: merge } = await admin.from("vendor_merges").select("kept_id").eq("id", mergeId as string).maybeSingle();
  revalidateVendors([fromId, intoId]);
  redirect(`/vendors/${(merge?.kept_id as string | undefined) ?? intoId}`);
}

export async function undoVendorMergeAction(_prev: VendorMergeState, formData: FormData): Promise<VendorMergeState> {
  const user = await requireVendorEdit();
  const mergeId = String(formData.get("merge_id") ?? "");
  if (!mergeId) return { error: "Merge not found." };

  const admin = createAdminClient();
  const { data: merge } = await admin
    .from("vendor_merges")
    .select("kept_id, merged_id")
    .eq("id", mergeId)
    .maybeSingle();
  const { error } = await admin.rpc("undo_vendor_merge", { p_merge: mergeId, p_actor: user.id });
  if (error) return { error: error.message };

  revalidateVendors([merge?.kept_id as string, merge?.merged_id as string].filter(Boolean));
  return { error: null };
}
