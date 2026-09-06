import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who the money goes to.
 *
 * Until migration 0027 the expense record knew who submitted it, who decided
 * it and who marked it paid — never who to pay. That worked only because the
 * instruction arrived out of band, in the email carrying the receipt: "Please
 * pay Miqdad Bhai", "pay Taj Mart directly", "these were all paid for by
 * myself" followed by a BSB and account number. The submitter is frequently
 * not the payee; one coordinator forwards on behalf of whoever stood at the
 * till. Once email stops, that has nowhere to live unless the record holds it.
 */

export type PayeeSuggestion = {
  id: string;
  displayName: string;
  /** "member", "vendor", or null for someone outside the system. */
  linkedTo: "member" | "vendor" | null;
  hasBankDetails: boolean;
};

export type PayeeChoice =
  | { kind: "me" }
  | { kind: "existing"; payeeId: string }
  | {
      kind: "new";
      displayName: string;
      vendorId?: string | null;
      bankAccountName?: string | null;
      bsb?: string | null;
      accountNumber?: string | null;
    };

function toSuggestion(row: {
  id: string;
  display_name: string;
  profile_id: string | null;
  vendor_id: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
}): PayeeSuggestion {
  return {
    id: row.id,
    displayName: row.display_name,
    linkedTo: row.profile_id ? "member" : row.vendor_id ? "vendor" : null,
    hasBankDetails: Boolean(row.bank_bsb && row.bank_account_number),
  };
}

const SELECT = "id, display_name, profile_id, vendor_id, bank_bsb, bank_account_number";

/**
 * The payee record for a member, created on first use.
 *
 * Lazily rather than by back-filling every profile: most members never submit
 * an expense, and a picker listing thirty names of whom two are ever paid is
 * worse than one listing the two.
 */
export async function payeeForProfile(
  admin: SupabaseClient,
  profileId: string,
  fallbackName: string
): Promise<string> {
  const { data: existing } = await admin
    .from("payees")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await admin
    .from("payees")
    .insert({ display_name: fallbackName, profile_id: profileId, created_by: profileId })
    .select("id")
    .single();

  // A concurrent first submission by the same person loses the unique index
  // race; read back rather than failing the submission over it.
  if (error) {
    const { data: raced } = await admin
      .from("payees")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (raced) return raced.id as string;
    throw new Error(error.message);
  }
  return data.id as string;
}

/** Resolves whatever the submitter chose into a payee id. */
export async function resolvePayee(
  admin: SupabaseClient,
  choice: PayeeChoice | null,
  actor: { id: string; fullName: string; email: string }
): Promise<string | null> {
  if (!choice) return null;

  if (choice.kind === "me") {
    return payeeForProfile(admin, actor.id, actor.fullName || actor.email);
  }

  if (choice.kind === "existing") return choice.payeeId;

  const displayName = choice.displayName.trim();
  if (!displayName) return null;

  // A vendor being paid directly has exactly one payee row, so "pay Taj Mart"
  // twice does not create two.
  if (choice.vendorId) {
    const { data: existing } = await admin
      .from("payees")
      .select("id")
      .eq("vendor_id", choice.vendorId)
      .maybeSingle();
    if (existing) return existing.id as string;
  }

  const { data, error } = await admin
    .from("payees")
    .insert({
      display_name: displayName,
      vendor_id: choice.vendorId ?? null,
      bank_account_name: choice.bankAccountName?.trim() || null,
      bank_bsb: choice.bsb?.replace(/\D/g, "") || null,
      bank_account_number: choice.accountNumber?.replace(/\D/g, "") || null,
      created_by: actor.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function searchPayees(
  admin: SupabaseClient,
  query: string
): Promise<PayeeSuggestion[]> {
  const trimmed = query.trim();
  const base = admin.from("payees").select(SELECT).eq("is_active", true).limit(8);

  // An empty box shows the most recently added rather than nothing: the payee
  // is usually someone who has been paid before.
  const { data } = trimmed
    ? await base.ilike("display_name", `%${trimmed}%`)
    : await base.order("created_at", { ascending: false });

  return (data ?? []).map(toSuggestion);
}

export async function getPayee(
  admin: SupabaseClient,
  payeeId: string
): Promise<PayeeSuggestion | null> {
  const { data } = await admin.from("payees").select(SELECT).eq("id", payeeId).maybeSingle();
  return data ? toSuggestion(data) : null;
}
