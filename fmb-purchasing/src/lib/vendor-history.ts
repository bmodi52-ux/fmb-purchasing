import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A vendor's change history (#45, migration 0055), written beside each change
 * the way item_history is. Bank details go in as events without numbers: the
 * history is shown to everyone who can see the vendor, and the numbers are
 * not theirs to see.
 */

export type VendorChangeKind =
  | "created"
  | "details_changed"
  | "usual_settings_changed"
  | "reviewed"
  | "contact_added"
  | "contact_removed"
  | "address_added"
  | "address_removed"
  | "bank_account_added"
  | "bank_details_changed"
  | "bank_account_replaced"
  | "bank_account_proposed"
  | "bank_account_confirmed"
  | "bank_account_discarded"
  | "gst_registration_changed";

export type FieldChanges = Record<string, { old: unknown; new: unknown }>;

/** An object as text with its keys in order: Postgres hands jsonb back with its own key order. */
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether two stored values say the same thing — objects by content, blanks alike. */
function same(a: unknown, b: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (blank(a) && blank(b)) return true;
  if (typeof a === "object" || typeof b === "object") return canonical(a) === canonical(b);
  return String(a) === String(b);
}

export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: (keyof T & string)[]): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    if (!same(before[field], after[field])) changes[field] = { old: before[field] ?? null, new: after[field] ?? null };
  }
  return changes;
}

/** Records one change. Never throws: the change itself has already happened. */
export async function recordVendorChange(
  admin: SupabaseClient,
  entry: { vendorId: string; userId: string | null; kind: VendorChangeKind; changes?: FieldChanges | { label: string } }
): Promise<void> {
  if (entry.kind === "details_changed" || entry.kind === "usual_settings_changed" || entry.kind === "gst_registration_changed") {
    if (!entry.changes || Object.keys(entry.changes).length === 0) return;
  }
  const { error } = await admin.from("vendor_changes").insert({
    vendor_id: entry.vendorId,
    changed_by: entry.userId,
    kind: entry.kind,
    changes: entry.changes ?? {},
  });
  if (error) console.error("[vendor-history] could not record:", error.message);
}

export const VENDOR_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  abn: "ABN",
  billing_address: "Billing address",
  status: "Status",
  default_category_id: "Usual category",
  default_payee: "Usually paid to",
  gst_treatment: "GST",
  gst_registered: "Registered for GST",
  abn_active: "ABN active",
};

const KIND_TEXT: Record<VendorChangeKind, string> = {
  created: "Added",
  details_changed: "Details changed",
  usual_settings_changed: "Usual settings changed",
  reviewed: "Reviewed",
  contact_added: "Contact added",
  contact_removed: "Contact removed",
  address_added: "Collection address added",
  address_removed: "Collection address removed",
  bank_account_added: "Bank account added",
  bank_details_changed: "Bank account details corrected",
  bank_account_replaced: "Bank account replaced with a new one",
  bank_account_proposed: "A different bank account was read off an invoice, waiting to be confirmed",
  bank_account_confirmed: "A proposed bank account was confirmed and is now the one paid",
  bank_account_discarded: "A proposed bank account was discarded",
  gst_registration_changed: "GST registration changed, according to the ABR",
};

export function vendorChangeTitle(kind: string, changes: unknown): string {
  const label = (changes as { label?: string } | null)?.label;
  const base = KIND_TEXT[kind as VendorChangeKind] ?? kind;
  return label ? `${base}: ${label}` : base;
}

/** A value as it reads in the history: addresses as one line, blanks as a dash. */
export function vendorValueText(field: string, value: unknown, lookups: { categoryName: (id: string) => string | null }): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "default_category_id") return lookups.categoryName(String(value)) ?? "a removed category";
  if (field === "default_payee") return value === "vendor" ? "The vendor, directly" : "The person who bought it";
  if (field === "gst_treatment") return value === "gst_free" ? "Everything GST-free" : "Everything includes GST";
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== "")
      .map(([, v]) => String(v));
    return parts.length ? parts.join(", ") : "—";
  }
  return String(value);
}
