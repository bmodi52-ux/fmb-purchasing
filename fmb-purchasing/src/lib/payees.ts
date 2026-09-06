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
  /**
   * Pay the vendor named on this receipt — an unpaid invoice rather than a
   * reimbursement. Carries no vendor id of its own: the expense has already
   * matched or created its vendor by the time this is resolved, and taking
   * that one is what makes the option work for a vendor being entered for the
   * first time. Bank details are optional because the vendor may already have
   * them on file, in which case they are not sent to the browser at all.
   */
  | {
      kind: "vendor";
      bankAccountName?: string | null;
      bsb?: string | null;
      accountNumber?: string | null;
    }
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

/**
 * Resolves whatever the submitter chose into a payee id.
 *
 * `vendor` takes the expense's own vendor, which the caller has already
 * matched or created — that is what lets "pay the vendor" work on a receipt
 * from a shop nobody has entered before.
 */
export async function resolvePayee(
  admin: SupabaseClient,
  choice: PayeeChoice | null,
  actor: { id: string; fullName: string; email: string },
  expenseVendor?: { id: string; name: string } | null
): Promise<string | null> {
  if (!choice) return null;

  if (choice.kind === "me") {
    return payeeForProfile(admin, actor.id, actor.fullName || actor.email);
  }

  if (choice.kind === "existing") return choice.payeeId;

  if (choice.kind === "vendor") {
    if (!expenseVendor) return null;
    return payeeForVendor(admin, {
      vendorId: expenseVendor.id,
      displayName: expenseVendor.name,
      bankAccountName: choice.bankAccountName,
      bsb: choice.bsb,
      accountNumber: choice.accountNumber,
      actorId: actor.id,
    });
  }

  const displayName = choice.displayName.trim();
  if (!displayName) return null;

  if (choice.vendorId) {
    return payeeForVendor(admin, {
      vendorId: choice.vendorId,
      displayName,
      bankAccountName: choice.bankAccountName,
      bsb: choice.bsb,
      accountNumber: choice.accountNumber,
      actorId: actor.id,
    });
  }

  const { data, error } = await admin
    .from("payees")
    .insert({
      display_name: displayName,
      vendor_id: null,
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

/**
 * The single payee row standing for "pay this vendor directly".
 *
 * One row per vendor, which 0027's payees_vendor_unique index has enforced
 * from the start — the gap was never the constraint, it was that nothing in
 * the app ever set vendor_id, so bank details entered for a vendor became a
 * payee floating free of the vendor record and the next receipt from the same
 * shop could not find them.
 *
 * Bank details supplied here fill gaps but never overwrite: a submitter typing
 * what they read off an invoice must not silently replace an account the
 * Treasurer set up, and detecting that a vendor changed banks is a decision
 * for a person, not a side effect of a submission.
 */
async function payeeForVendor(
  admin: SupabaseClient,
  input: {
    vendorId: string;
    displayName: string;
    bankAccountName?: string | null;
    bsb?: string | null;
    accountNumber?: string | null;
    actorId: string;
  }
): Promise<string> {
  const bank = {
    bank_account_name: input.bankAccountName?.trim() || null,
    bank_bsb: input.bsb?.replace(/\D/g, "") || null,
    bank_account_number: input.accountNumber?.replace(/\D/g, "") || null,
  };

  const { data: existing } = await admin
    .from("payees")
    .select("id, bank_account_name, bank_bsb, bank_account_number")
    .eq("vendor_id", input.vendorId)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = existing?.[0];
  if (row) {
    const fills = Object.fromEntries(
      Object.entries(bank).filter(([key, value]) => value && !row[key as keyof typeof row])
    );
    if (Object.keys(fills).length > 0) {
      await admin.from("payees").update(fills).eq("id", row.id);
    }
    return row.id as string;
  }

  const { data, error } = await admin
    .from("payees")
    .insert({
      display_name: input.displayName,
      vendor_id: input.vendorId,
      ...bank,
      created_by: input.actorId,
    })
    .select("id")
    .single();

  // Two submissions naming the same new vendor race here; the unique index
  // picks a winner and the loser reads back what it wanted.
  if (error) {
    const { data: raced } = await admin
      .from("payees")
      .select("id")
      .eq("vendor_id", input.vendorId)
      .limit(1);
    if (raced?.[0]) return raced[0].id as string;
    throw new Error(error.message);
  }
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

export type VendorPaymentDetails = {
  payeeId: string;
  displayName: string;
  bankAccountName: string | null;
  bsb: string | null;
  accountNumber: string | null;
};

/**
 * How to pay this vendor directly, if anyone has said.
 *
 * 0027 gave payees a vendor_id for exactly the "pay Taj Mart directly" case,
 * but nothing in the app ever set it and nothing ever read it: bank details
 * typed for a vendor were saved as a free-floating payee with no link back, so
 * the next receipt from the same shop could not find them and they were typed
 * again. This is the read half of closing that loop.
 */
export async function vendorPaymentDetails(
  admin: SupabaseClient,
  vendorId: string
): Promise<VendorPaymentDetails | null> {
  const { data } = await admin
    .from("payees")
    .select("id, display_name, bank_account_name, bank_bsb, bank_account_number")
    .eq("vendor_id", vendorId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;
  return {
    payeeId: row.id as string,
    displayName: row.display_name as string,
    bankAccountName: row.bank_account_name as string | null,
    bsb: row.bank_bsb as string | null,
    accountNumber: row.bank_account_number as string | null,
  };
}
