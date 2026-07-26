"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

async function requireVendorEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "edit_master_data");
}

export async function updateVendorDetails(formData: FormData) {
  await requireVendorEdit();
  const vendorId = String(formData.get("vendor_id"));
  const name = String(formData.get("name") ?? "").trim();
  const abn = String(formData.get("abn") ?? "").replace(/\D/g, "") || null;
  if (!vendorId || !name) return;

  const billingAddress = {
    line1: String(formData.get("billing_line1") ?? "").trim() || null,
    line2: String(formData.get("billing_line2") ?? "").trim() || null,
    suburb: String(formData.get("billing_suburb") ?? "").trim() || null,
    state: String(formData.get("billing_state") ?? "").trim() || null,
    postcode: String(formData.get("billing_postcode") ?? "").trim() || null,
    country: String(formData.get("billing_country") ?? "").trim() || "Australia",
  };
  const hasAnyAddressField = Object.entries(billingAddress).some(
    ([key, v]) => key !== "country" && v
  );

  const admin = createAdminClient();
  await admin
    .from("vendors")
    .update({ name, abn, billing_address: hasAnyAddressField ? billingAddress : null })
    .eq("id", vendorId);

  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/vendors");
}

export async function addCollectionAddress(formData: FormData) {
  await requireVendorEdit();
  const vendorId = String(formData.get("vendor_id"));
  const line1 = String(formData.get("line1") ?? "").trim();
  if (!vendorId || !line1) return;

  const admin = createAdminClient();
  await admin.from("vendor_collection_addresses").insert({
    vendor_id: vendorId,
    label: String(formData.get("label") ?? "").trim() || null,
    line1,
    line2: String(formData.get("line2") ?? "").trim() || null,
    suburb: String(formData.get("suburb") ?? "").trim() || null,
    state: String(formData.get("state") ?? "").trim() || null,
    postcode: String(formData.get("postcode") ?? "").trim() || null,
    country: String(formData.get("country") ?? "").trim() || "Australia",
  });

  revalidatePath(`/vendors/${vendorId}`);
}

export async function removeCollectionAddress(formData: FormData) {
  await requireVendorEdit();
  const addressId = String(formData.get("address_id"));
  const vendorId = String(formData.get("vendor_id"));
  if (!addressId) return;

  const admin = createAdminClient();
  await admin.from("vendor_collection_addresses").delete().eq("id", addressId);
  revalidatePath(`/vendors/${vendorId}`);
}

export async function addContact(formData: FormData) {
  await requireVendorEdit();
  const vendorId = String(formData.get("vendor_id"));
  const name = String(formData.get("contact_name") ?? "").trim();
  if (!vendorId || !name) return;

  const admin = createAdminClient();
  await admin.from("vendor_contacts").insert({
    vendor_id: vendorId,
    name,
    phone: String(formData.get("contact_phone") ?? "").trim() || null,
  });

  revalidatePath(`/vendors/${vendorId}`);
}

export async function removeContact(formData: FormData) {
  await requireVendorEdit();
  const contactId = String(formData.get("contact_id"));
  const vendorId = String(formData.get("vendor_id"));
  if (!contactId) return;

  const admin = createAdminClient();
  await admin.from("vendor_contacts").delete().eq("id", contactId);
  revalidatePath(`/vendors/${vendorId}`);
}
