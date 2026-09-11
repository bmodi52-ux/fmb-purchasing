import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupAbn } from "@/lib/abn-lookup";

/**
 * A vendor's GST registration, kept current from the ABR (migration 0047).
 */

/** How old a check can be before an incoming expense triggers another. */
export const REGISTRATION_MAX_AGE_DAYS = 30;

export type VendorRegistration = {
  gst_registered: boolean | null;
  gst_registered_from: string | null;
  abn_active: boolean | null;
  abr_checked_at: string | null;
};

/**
 * Asks the ABR about this vendor's ABN and records the answer. Never throws:
 * this runs beside the thing a person asked for, and an unreachable ABR must
 * not fail it. Returns whether a fresh answer was recorded.
 */
export async function refreshVendorRegistration(
  admin: SupabaseClient,
  vendorId: string,
  abn: string | null
): Promise<boolean> {
  const digits = abn?.replace(/\D/g, "") ?? "";
  if (digits.length !== 11) {
    await admin
      .from("vendors")
      .update({ gst_registered: null, gst_registered_from: null, abn_active: null, abr_checked_at: null })
      .eq("id", vendorId);
    return false;
  }

  const result = await lookupAbn(digits);
  if ("error" in result) return false;

  await admin
    .from("vendors")
    .update({
      gst_registered: result.gstRegistered,
      gst_registered_from: result.gstRegisteredFrom,
      abn_active: result.abnActive,
      abr_checked_at: new Date().toISOString(),
    })
    .eq("id", vendorId);
  return true;
}

export function registrationIsStale(checkedAt: string | null, now = new Date()): boolean {
  if (!checkedAt) return true;
  return now.getTime() - new Date(checkedAt).getTime() > REGISTRATION_MAX_AGE_DAYS * 86_400_000;
}

export type GstConcern = "gst-not-registered" | "abn-cancelled";

/**
 * What is wrong, if anything, with GST on an expense from this vendor.
 *
 * Only a definite answer from the ABR raises a concern; "never checked" is
 * not one.
 */
export function gstConcerns(
  vendor: Pick<VendorRegistration, "gst_registered" | "abn_active"> | null,
  gstCharged: number
): GstConcern[] {
  if (!vendor) return [];
  const concerns: GstConcern[] = [];
  if (vendor.gst_registered === false && gstCharged > 0) concerns.push("gst-not-registered");
  if (vendor.abn_active === false) concerns.push("abn-cancelled");
  return concerns;
}

export const GST_CONCERN_LABEL: Record<GstConcern, string> = {
  "gst-not-registered": "GST charged, but the vendor isn't registered for GST",
  "abn-cancelled": "The vendor's ABN is cancelled",
};
