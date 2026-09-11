import type { SupabaseClient } from "@supabase/supabase-js";
import { recordVendorChange } from "@/lib/vendor-history";

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
      /**
       * Set when the submitter says the account on file is out of date and
       * these are the details printed on the invoice in front of them.
       * Recorded as a proposal beside the current account, never over it — see
       * proposeVendorAccount.
       */
      replacesCurrent?: boolean;
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
      replacesCurrent: choice.replacesCurrent,
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
 * The payee row standing for "pay this vendor directly".
 *
 * One *approved* row per vendor, which 0037's payees_vendor_approved_unique
 * index enforces — the gap 0027 left was never the constraint, it was that
 * nothing in the app ever set vendor_id, so bank details entered for a vendor
 * became a payee floating free of the vendor record and the next receipt from
 * the same shop could not find them.
 *
 * Bank details supplied here fill gaps but never overwrite: a submitter typing
 * what they read off an invoice must not silently replace an account the
 * Treasurer set up. When the invoice shows a *different* account, that is
 * `replacesCurrent` below — a proposal recorded beside the current one, not a
 * change to it.
 */
async function payeeForVendor(
  admin: SupabaseClient,
  input: {
    vendorId: string;
    displayName: string;
    bankAccountName?: string | null;
    bsb?: string | null;
    accountNumber?: string | null;
    /**
     * The submitter says this vendor's account has changed, and these are the
     * details from the invoice in front of them.
     *
     * Written as a pending row of its own rather than over the approved one.
     * Changed bank details on an invoice are the classic payment fraud, so the
     * account on file is never altered by a submission — a holder of
     * payments:mark_paid confirms it from the vendor page, and until then the
     * old account is still what "pay this vendor" resolves to for everyone
     * else.
     */
    replacesCurrent?: boolean;
    actorId: string;
  }
): Promise<string> {
  const bank = {
    bank_account_name: input.bankAccountName?.trim() || null,
    bank_bsb: input.bsb?.replace(/\D/g, "") || null,
    bank_account_number: input.accountNumber?.replace(/\D/g, "") || null,
  };

  if (input.replacesCurrent && (bank.bank_bsb || bank.bank_account_number)) {
    return proposeVendorAccount(admin, {
      vendorId: input.vendorId,
      displayName: input.displayName,
      bank,
      actorId: input.actorId,
    });
  }

  const { data: existing } = await admin
    .from("payees")
    .select("id, bank_account_name, bank_bsb, bank_account_number")
    .eq("vendor_id", input.vendorId)
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(1);

  const row = existing?.[0];
  if (row) {
    const fills = Object.fromEntries(
      Object.entries(bank).filter(([key, value]) => value && !row[key as keyof typeof row])
    );
    if (Object.keys(fills).length > 0) {
      await admin.from("payees").update(fills).eq("id", row.id);
      await recordVendorChange(admin, {
        vendorId: input.vendorId,
        userId: input.actorId,
        kind: "bank_details_changed",
        changes: { label: "missing details filled in from an invoice" },
      });
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
  if (!error && (bank.bank_bsb || bank.bank_account_number)) {
    await recordVendorChange(admin, {
      vendorId: input.vendorId,
      userId: input.actorId,
      kind: "bank_account_added",
      changes: { label: "from an invoice" },
    });
  }

  // Two submissions naming the same new vendor race here; the unique index
  // picks a winner and the loser reads back what it wanted.
  if (error) {
    const { data: raced } = await admin
      .from("payees")
      .select("id")
      .eq("vendor_id", input.vendorId)
      .eq("status", "approved")
      .limit(1);
    if (raced?.[0]) return raced[0].id as string;
    throw new Error(error.message);
  }
  return data.id as string;
}

/**
 * Record an account a submitter read off an invoice, without touching the one
 * on file.
 *
 * Returns the proposed row's id, so the expense itself carries the account its
 * submitter meant — the Treasurer paying it sees the details that came with
 * the invoice, marked as unconfirmed, rather than an account the invoice
 * contradicts.
 *
 * An identical proposal already waiting is reused rather than duplicated:
 * three invoices in the same week with the vendor's new BSB is one change of
 * bank, and should read as one thing to confirm.
 */
async function proposeVendorAccount(
  admin: SupabaseClient,
  input: {
    vendorId: string;
    displayName: string;
    bank: { bank_account_name: string | null; bank_bsb: string | null; bank_account_number: string | null };
    actorId: string;
  }
): Promise<string> {
  const { data: current } = await admin
    .from("payees")
    .select("id, bank_bsb, bank_account_number")
    .eq("vendor_id", input.vendorId)
    .eq("status", "approved")
    .limit(1);

  // Not a change at all — the submitter retyped what is already on file.
  const onFile = current?.[0];
  if (
    onFile &&
    (onFile.bank_bsb ?? null) === input.bank.bank_bsb &&
    (onFile.bank_account_number ?? null) === input.bank.bank_account_number
  ) {
    return onFile.id as string;
  }

  const { data: alreadyProposed } = await admin
    .from("payees")
    .select("id")
    .eq("vendor_id", input.vendorId)
    .eq("status", "pending")
    .eq("bank_bsb", input.bank.bank_bsb)
    .eq("bank_account_number", input.bank.bank_account_number)
    .limit(1);
  if (alreadyProposed?.[0]) return alreadyProposed[0].id as string;

  const { data, error } = await admin
    .from("payees")
    .insert({
      display_name: input.displayName,
      vendor_id: input.vendorId,
      ...input.bank,
      status: "pending",
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await recordVendorChange(admin, { vendorId: input.vendorId, userId: input.actorId, kind: "bank_account_proposed" });
  return data.id as string;
}

export async function searchPayees(
  admin: SupabaseClient,
  query: string
): Promise<PayeeSuggestion[]> {
  const trimmed = query.trim();
  const base = admin
    .from("payees")
    .select(SELECT)
    .eq("is_active", true)
    // A superseded account is not somewhere to send money, and a pending one
    // belongs to the invoice that proposed it — neither is a choice to offer
    // from a search box. getPayee still resolves them by id, so an expense
    // already pointing at one still reads back.
    .eq("status", "approved")
    .limit(8);

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
