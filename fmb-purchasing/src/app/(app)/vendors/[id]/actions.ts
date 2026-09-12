"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { after } from "next/server";
import { refreshVendorRegistration } from "@/lib/vendor-registration";

async function requireVendorEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "edit_master_data");
}

/** Asks the ABR now, rather than waiting for the next expense to (#30). */
export async function checkVendorRegistration(formData: FormData) {
  await requireVendorEdit();
  const vendorId = String(formData.get("vendor_id"));
  if (!vendorId) return;

  const admin = createAdminClient();
  const { data: vendor } = await admin.from("vendors").select("abn").eq("id", vendorId).maybeSingle();
  if (!vendor) return;

  const refreshed = await refreshVendorRegistration(admin, vendorId, vendor.abn as string | null);
  if (!refreshed && vendor.abn) {
    throw new Error("The ABR couldn't be reached, or doesn't recognise this ABN. Check the ABN and try again.");
  }
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/approvals");
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
  const { data: before } = await admin.from("vendors").select("abn").eq("id", vendorId).maybeSingle();
  await admin
    .from("vendors")
    .update({ name, abn, billing_address: hasAnyAddressField ? billingAddress : null })
    .eq("id", vendorId);

  // A changed ABN makes the recorded GST registration someone else's (#30).
  if ((before?.abn ?? null) !== abn) {
    after(() => refreshVendorRegistration(admin, vendorId, abn));
  }

  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/vendors");
  revalidateReports();
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

/**
 * Bank details for paying this vendor directly.
 *
 * Gated on payments:mark_paid rather than vendors:edit_master_data. 0027 drew
 * that line deliberately — bank details are visible "only to whoever holds
 * payments:mark_paid" — and the person who knows a supplier's account is the
 * one who transfers to it. Someone maintaining vendor master data can still
 * see whether details exist, which is all they need to know.
 *
 * Note that submitters can still *supply* details for a vendor with none, from
 * the invoice, at submit time. Writing what you can read off the paperwork in
 * front of you is a different act from reading back what the organisation has
 * on file, and payeeForVendor never overwrites an account already recorded.
 *
 * Changing the account no longer edits the row. A vendor that changes banks
 * gets a new account record, and the old one is marked superseded and kept —
 * so an expense paid last year still says which account the money went to,
 * which overwriting destroyed. See migration 0037.
 */
export async function updateVendorPaymentDetails(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const vendorId = String(formData.get("vendor_id"));
  if (!vendorId) return;

  const admin = createAdminClient();
  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", vendorId)
    .maybeSingle();
  if (!vendor) return;

  const details = {
    bank_account_name: String(formData.get("bank_account_name") ?? "").trim() || null,
    bank_bsb: String(formData.get("bank_bsb") ?? "").replace(/\D/g, "") || null,
    bank_account_number: String(formData.get("bank_account_number") ?? "").replace(/\D/g, "") || null,
    notes: String(formData.get("payment_notes") ?? "").trim() || null,
    // Where the remittance advice goes when they are paid (#37). Describes the
    // account rather than changing it, like the notes.
    remittance_email: String(formData.get("remittance_email") ?? "").trim() || null,
  };

  const { data: existing } = await admin
    .from("payees")
    .select("id, bank_account_name, bank_bsb, bank_account_number, notes")
    .eq("vendor_id", vendorId)
    .eq("status", "approved")
    .limit(1);

  const current = existing?.[0];
  if (!current) {
    await admin.from("payees").insert({
      display_name: vendor.name as string,
      vendor_id: vendorId,
      ...details,
      status: "approved",
      created_by: user.id,
    });
    revalidatePath(`/vendors/${vendorId}`);
    return;
  }

  // Only the account itself is history. Correcting a typo in the account name,
  // or adding "pays by PayID" to the notes, is describing the same account
  // better — filing that as a bank change would bury the real ones.
  const accountChanged =
    (current.bank_bsb ?? null) !== details.bank_bsb ||
    (current.bank_account_number ?? null) !== details.bank_account_number;

  if (!accountChanged) {
    await admin
      .from("payees")
      .update({ ...details, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    revalidatePath(`/vendors/${vendorId}`);
    return;
  }

  await replaceVendorAccount(admin, {
    vendorId,
    displayName: vendor.name as string,
    currentPayeeId: current.id as string,
    details,
    userId: user.id,
  });

  revalidatePath(`/vendors/${vendorId}`);
}

/**
 * Swap in a new account for a vendor, keeping the old one as history.
 *
 * Ordered so the unique index is never asked to hold two approved accounts for
 * one vendor: the outgoing row is superseded first, then the new row is
 * inserted, then the old row is pointed at its replacement. A failure between
 * the steps leaves a vendor with no approved account rather than two, which is
 * the safer half of the trade — nothing can be paid to a wrong account by
 * accident, and the details are still on the page to re-enter.
 */
async function replaceVendorAccount(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    vendorId: string;
    displayName: string;
    currentPayeeId: string;
    details: Record<string, string | null>;
    userId: string;
  }
) {
  const now = new Date().toISOString();

  await admin
    .from("payees")
    .update({ status: "superseded", superseded_at: now, updated_at: now })
    .eq("id", input.currentPayeeId);

  const { data: created } = await admin
    .from("payees")
    .insert({
      display_name: input.displayName,
      vendor_id: input.vendorId,
      ...input.details,
      status: "approved",
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (created) {
    await admin
      .from("payees")
      .update({ superseded_by: created.id })
      .eq("id", input.currentPayeeId);
  }
}

/**
 * Accept an account a submitter read off an invoice, or discard it.
 *
 * The confirmation step that lets a submitter report a changed account without
 * being able to change it: their details sit as a pending row until whoever
 * holds payments:mark_paid — the person who will make the transfer — says that
 * is genuinely where this vendor is paid now.
 */
export async function reviewProposedVendorAccount(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const payeeId = String(formData.get("payee_id"));
  const vendorId = String(formData.get("vendor_id"));
  const decision = String(formData.get("decision"));
  if (!payeeId || !vendorId || (decision !== "accept" && decision !== "discard")) return;

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: proposed } = await admin
    .from("payees")
    .select("id, vendor_id, status")
    .eq("id", payeeId)
    .maybeSingle();
  // Re-checked rather than trusted: the id arrives from a form, and accepting
  // one vendor's account onto another would be a payment sent to the wrong
  // supplier.
  if (!proposed || proposed.vendor_id !== vendorId || proposed.status !== "pending") return;

  if (decision === "discard") {
    // Superseded, not deleted: an expense may already point at this row, and
    // "the details we were given and rejected" is worth being able to see.
    await admin
      .from("payees")
      .update({ status: "superseded", superseded_at: now, updated_at: now })
      .eq("id", payeeId);
    revalidatePath(`/vendors/${vendorId}`);
    return;
  }

  const { data: current } = await admin
    .from("payees")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("status", "approved")
    .limit(1);

  if (current?.[0]) {
    await admin
      .from("payees")
      .update({
        status: "superseded",
        superseded_at: now,
        superseded_by: payeeId,
        updated_at: now,
      })
      .eq("id", current[0].id);
  }

  await admin
    .from("payees")
    .update({ status: "approved", updated_at: now })
    .eq("id", payeeId);

  revalidatePath(`/vendors/${vendorId}`);
}
