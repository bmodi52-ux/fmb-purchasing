"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { lookupAbn, searchAbnByName, type AbnLookupResult } from "@/lib/abn-lookup";
import { after } from "next/server";
import { refreshVendorRegistration } from "@/lib/vendor-registration";
import { alertOnVendorAdded } from "@/lib/expense-alerts";

async function requireVendorEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "edit_master_data");
  return user;
}

export type CreateVendorState = { error: string | null; success: boolean };

function fieldOrNull(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

export async function createVendor(
  _prev: CreateVendorState,
  formData: FormData
): Promise<CreateVendorState> {
  const user = await requireVendorEdit();

  const name = String(formData.get("name") ?? "").trim();
  const abn = String(formData.get("abn") ?? "").replace(/\D/g, "") || null;
  if (!name) return { error: "Vendor name is required.", success: false };

  const admin = createAdminClient();

  if (abn) {
    const { data: existing } = await admin
      .from("vendors")
      .select("vendor_number, name")
      .eq("abn", abn)
      .maybeSingle();
    if (existing) {
      return {
        error: `A vendor with this ABN already exists: ${existing.vendor_number} — ${existing.name}.`,
        success: false,
      };
    }
  }

  const billingAddress = {
    line1: fieldOrNull(formData, "billing_line1"),
    line2: fieldOrNull(formData, "billing_line2"),
    suburb: fieldOrNull(formData, "billing_suburb"),
    state: fieldOrNull(formData, "billing_state"),
    postcode: fieldOrNull(formData, "billing_postcode"),
    country: fieldOrNull(formData, "billing_country") || "Australia",
  };
  const hasBillingAddress = Object.entries(billingAddress).some(
    ([key, v]) => key !== "country" && v
  );

  const { data: vendor, error } = await admin
    .from("vendors")
    .insert({
      name,
      abn,
      billing_address: hasBillingAddress ? billingAddress : null,
      status: "approved",
      created_by: user.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !vendor) return { error: error?.message ?? "Could not create vendor.", success: false };

  // GST registration from the ABR, once the response has gone (#30).
  if (abn) after(() => refreshVendorRegistration(admin, vendor.id, abn));
  alertOnVendorAdded(admin, { id: vendor.id, name });

  const contactName = fieldOrNull(formData, "contact_name");
  if (contactName) {
    await admin.from("vendor_contacts").insert({
      vendor_id: vendor.id,
      name: contactName,
      phone: fieldOrNull(formData, "contact_phone"),
    });
  }

  const collectionLine1 = fieldOrNull(formData, "collection_line1");
  if (collectionLine1) {
    await admin.from("vendor_collection_addresses").insert({
      vendor_id: vendor.id,
      label: fieldOrNull(formData, "collection_label"),
      line1: collectionLine1,
      line2: fieldOrNull(formData, "collection_line2"),
      suburb: fieldOrNull(formData, "collection_suburb"),
      state: fieldOrNull(formData, "collection_state"),
      postcode: fieldOrNull(formData, "collection_postcode"),
      country: fieldOrNull(formData, "collection_country") || "Australia",
    });
  }

  revalidatePath("/vendors");
  revalidateReports();
  return { error: null, success: true };
}

async function reviewVendors(vendorIds: string[], decision: "approved" | "rejected") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "approve_master_data");
  if (vendorIds.length === 0) return;

  const admin = createAdminClient();
  await admin
    .from("vendors")
    .update({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .in("id", vendorIds);
  revalidatePath("/vendors");
  // The decision can now be made from the vendor's own page, which has to stop
  // showing the status it was made against.
  revalidatePath("/vendors/[id]", "page");
  revalidateReports();
}

export async function reviewVendor(formData: FormData) {
  const vendorId = String(formData.get("vendor_id"));
  const decision = String(formData.get("decision"));
  if (!vendorId || (decision !== "approved" && decision !== "rejected")) return;
  await reviewVendors([vendorId], decision);
}

export async function bulkReviewVendors(vendorIds: string[], decision: "approved" | "rejected") {
  await reviewVendors(vendorIds, decision);
}

export async function lookupAbnAction(abn: string): Promise<AbnLookupResult> {
  await requireVendorEdit();
  return lookupAbn(abn);
}

export type VendorSuggestion = {
  source: "existing" | "abr";
  name: string;
  abn: string | null;
  vendorId?: string;
  vendorNumber?: string;
  state?: string | null;
  postcode?: string | null;
};

/** Merges local Vendors matches with ABR business-name search, for the name typeahead. */
export async function searchVendorSuggestions(query: string): Promise<VendorSuggestion[]> {
  await requireVendorEdit();
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const admin = createAdminClient();
  const [{ data: localMatches }, abrMatches] = await Promise.all([
    admin
      .from("vendors")
      .select("id, vendor_number, name, abn")
      .ilike("name", `%${trimmed}%`)
      .limit(6),
    searchAbnByName(trimmed),
  ]);

  const existing: VendorSuggestion[] = (localMatches ?? []).map((v) => ({
    source: "existing",
    name: v.name,
    abn: v.abn,
    vendorId: v.id,
    vendorNumber: v.vendor_number,
  }));

  const existingAbns = new Set(existing.map((v) => v.abn).filter(Boolean));
  const abr: VendorSuggestion[] = abrMatches
    .filter((m) => !existingAbns.has(m.abn))
    .map((m) => ({ source: "abr", name: m.name, abn: m.abn, state: m.state, postcode: m.postcode }));

  return [...existing, ...abr].slice(0, 10);
}
