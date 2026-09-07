import { SubmitButton } from "@/components/submit-button";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateVendorDetails,
  addCollectionAddress,
  removeCollectionAddress,
  addContact,
  removeContact,
  updateVendorPaymentDetails,
  reviewProposedVendorAccount,
} from "./actions";
import { reviewVendor } from "../actions";
import { formatDate } from "@/lib/format";
import { ReviewDecision, StatusPill } from "@/components/review-decision";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient()
    .from("vendors")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (data?.name as string | null) ?? "Vendor" };
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "vendors", "edit_master_data");
  const canApprove = can(permissions, "vendors", "approve_master_data");
  // The trust boundary 0027 drew: bank details belong to whoever transfers the
  // money, not to everyone who can read a vendor record.
  const canSeeBankDetails = can(permissions, "payments", "mark_paid");

  const admin = createAdminClient();
  const [{ data: vendor }, { data: addresses }, { data: contacts }, paymentRow] = await Promise.all([
    admin.from("vendors").select("*").eq("id", id).maybeSingle(),
    admin.from("vendor_collection_addresses").select("*").eq("vendor_id", id).order("created_at"),
    admin.from("vendor_contacts").select("*").eq("vendor_id", id).order("created_at"),
    // Every account this vendor has ever had, newest first: the one in use,
    // anything a submitter has proposed off an invoice, and the ones they
    // replaced. See migration 0037.
    admin
      .from("payees")
      .select("id, bank_account_name, bank_bsb, bank_account_number, notes, status, created_at, superseded_at")
      .eq("vendor_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!vendor) notFound();

  const accounts = paymentRow.data ?? [];
  const stored = accounts.find((a) => a.status === "approved");
  const proposed = accounts.filter((a) => a.status === "pending");
  const superseded = accounts.filter((a) => a.status === "superseded");
  // Nothing but presence leaves the server unless the viewer may see the
  // numbers — an unused field in a payload is still a disclosure.
  const payment = stored
    ? {
        bankAccountName: canSeeBankDetails ? ((stored.bank_account_name as string | null) ?? "") : null,
        bsb: canSeeBankDetails ? ((stored.bank_bsb as string | null) ?? "") : null,
        accountNumber: canSeeBankDetails ? ((stored.bank_account_number as string | null) ?? "") : null,
        notes: canSeeBankDetails ? ((stored.notes as string | null) ?? "") : null,
      }
    : null;

  const billing = (vendor.billing_address ?? {}) as Record<string, string | null>;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/vendors" className="text-sm text-ink/50 hover:text-ink">
          ← Vendors
        </Link>
        {/* Wraps so a long vendor name doesn't squeeze the reference code
            against the edge on a narrow screen. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{vendor.name}</h1>
          <span className="font-mono text-sm text-ink/50">{vendor.vendor_number}</span>
          <StatusPill status={vendor.status as string} />
        </div>

        {canApprove && vendor.status === "pending" && (
          <ReviewDecision
            action={reviewVendor}
            idField="vendor_id"
            id={vendor.id}
            approveLabel="Approve vendor"
            note="Approving lets receipts be filed against this vendor without a second look."
          />
        )}
      </div>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 section-title text-ink">Details</h2>
        <form action={updateVendorDetails} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="vendor_id" value={vendor.id} />
          <Field label="Vendor name">
            <input name="name" defaultValue={vendor.name} disabled={!canEdit} required className="input" />
          </Field>
          <Field label="ABN">
            <input name="abn" defaultValue={vendor.abn ?? ""} disabled={!canEdit} className="input" />
          </Field>

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink/70">Billing address</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="billing_line1" placeholder="Address line 1" defaultValue={billing.line1 ?? ""} disabled={!canEdit} className="input sm:col-span-2" />
              <input name="billing_line2" placeholder="Address line 2" defaultValue={billing.line2 ?? ""} disabled={!canEdit} className="input sm:col-span-2" />
              <input name="billing_suburb" placeholder="Suburb" defaultValue={billing.suburb ?? ""} disabled={!canEdit} className="input" />
              <input name="billing_state" placeholder="State" defaultValue={billing.state ?? ""} disabled={!canEdit} className="input" />
              <input name="billing_postcode" placeholder="Postcode" defaultValue={billing.postcode ?? ""} disabled={!canEdit} className="input" />
              <input name="billing_country" placeholder="Country" defaultValue={billing.country ?? "Australia"} disabled={!canEdit} className="input" />
            </div>
          </div>

          {canEdit && (
            <SubmitButton className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep sm:col-span-2">
              Save details
            </SubmitButton>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">Payment details</h2>
        <p className="mb-4 text-sm text-ink/55">
          Where to transfer when an invoice from this vendor is paid directly rather than
          reimbursed to whoever bought it.
        </p>

        {/* Details a submitter read off an invoice that disagreed with the
            account on file. They are shown here rather than applied, because a
            changed BSB on an invoice is the classic payment fraud — the person
            who will make the transfer is the one who decides it is real. */}
        {canSeeBankDetails && proposed.length > 0 && (
          <div className="mb-5 flex flex-col gap-3 rounded-md border border-gold/50 bg-gold/10 p-4">
            <p className="text-sm font-medium text-ink">
              {proposed.length === 1
                ? "A submitter read different details off an invoice"
                : `${proposed.length} sets of details from invoices disagree with the account on file`}
            </p>
            {proposed.map((account) => (
              <div key={account.id as string} className="flex flex-wrap items-end justify-between gap-3">
                <div className="text-sm">
                  <p className="text-ink/80">{(account.bank_account_name as string | null) || "—"}</p>
                  <p className="font-mono text-ink/70">
                    BSB {(account.bank_bsb as string | null) || "—"} · Acct{" "}
                    {(account.bank_account_number as string | null) || "—"}
                  </p>
                  <p className="text-xs text-ink/45">
                    Supplied {formatDate(account.created_at as string)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={reviewProposedVendorAccount}>
                    <input type="hidden" name="vendor_id" value={vendor.id} />
                    <input type="hidden" name="payee_id" value={account.id as string} />
                    <input type="hidden" name="decision" value="accept" />
                    <SubmitButton className="rounded-md bg-palm px-3 py-1.5 text-sm font-medium text-white hover:bg-palm/90">
                      Use these from now on
                    </SubmitButton>
                  </form>
                  <form action={reviewProposedVendorAccount}>
                    <input type="hidden" name="vendor_id" value={vendor.id} />
                    <input type="hidden" name="payee_id" value={account.id as string} />
                    <input type="hidden" name="decision" value="discard" />
                    <SubmitButton className="rounded-md border border-ink/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5">
                      Discard
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        {canSeeBankDetails ? (
          <form action={updateVendorPaymentDetails} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="vendor_id" value={vendor.id} />
            <Field label="Account name">
              <input name="bank_account_name" defaultValue={payment?.bankAccountName ?? ""} className="input" />
            </Field>
            <Field label="BSB">
              <input
                name="bank_bsb"
                defaultValue={payment?.bsb ?? ""}
                inputMode="numeric"
                placeholder="082112"
                className="input font-mono"
              />
            </Field>
            <Field label="Account number">
              <input
                name="bank_account_number"
                defaultValue={payment?.accountNumber ?? ""}
                inputMode="numeric"
                className="input font-mono"
              />
            </Field>
            <Field label="Notes">
              <input
                name="payment_notes"
                defaultValue={payment?.notes ?? ""}
                placeholder="e.g. pays by PayID"
                className="input"
              />
            </Field>
            {/* Saying so here rather than after the fact: entering a different
                BSB or account number does not edit this record, it starts a
                new one and keeps the old. */}
            <p className="text-xs text-ink/45 sm:col-span-2">
              Changing the BSB or account number files the current account as
              past and records the new one, so paid expenses still say where the
              money went.
            </p>
            <SubmitButton className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep sm:col-span-2">
              Save payment details
            </SubmitButton>
          </form>
        ) : (
          // Deliberately not the numbers: 0027 put those behind
          // payments:mark_paid, and whether an account is on file is the only
          // part anyone else needs in order to know it is not missing.
          <p className="text-sm text-ink/70">
            {payment
              ? "Bank details are on file. They are visible only to whoever makes the payment."
              : "No bank details on file for this vendor."}
          </p>
        )}

        {/* Where the money used to go. Kept because a payment made in 2025
            was made to the account of 2025, and an expense record that cannot
            say which account it was is a record of very little. */}
        {canSeeBankDetails && superseded.length > 0 && (
          <details className="mt-5 border-t border-ink/10 pt-4">
            <summary className="cursor-pointer text-sm text-ink/60">
              {superseded.length} past account{superseded.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {superseded.map((account) => (
                <li key={account.id as string} className="text-ink/60">
                  <span className="font-mono">
                    BSB {(account.bank_bsb as string | null) || "—"} · Acct{" "}
                    {(account.bank_account_number as string | null) || "—"}
                  </span>
                  {account.bank_account_name && (
                    <span className="ml-2">{account.bank_account_name as string}</span>
                  )}
                  <span className="ml-2 text-xs text-ink/40">
                    used until {formatDate(account.superseded_at as string)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 section-title text-ink">Collection addresses</h2>
        <ul className="mb-4 flex flex-col gap-3">
          {(addresses ?? []).map((a) => (
            <li key={a.id} className="flex items-start justify-between rounded-md border border-ink/10 bg-white p-3 text-sm">
              <div>
                {a.label && <p className="font-medium text-ink">{a.label}</p>}
                <p className="text-ink/70">
                  {[a.line1, a.line2, a.suburb, a.state, a.postcode, a.country].filter(Boolean).join(", ")}
                </p>
              </div>
              {canEdit && (
                <form action={removeCollectionAddress}>
                  <input type="hidden" name="address_id" value={a.id} />
                  <input type="hidden" name="vendor_id" value={vendor.id} />
                  <SubmitButton className="text-xs text-maroon/70 hover:underline">
                    remove
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
          {(addresses ?? []).length === 0 && <li className="text-sm text-ink/50">None yet.</li>}
        </ul>

        {canEdit && (
          <form action={addCollectionAddress} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="vendor_id" value={vendor.id} />
            <input name="label" placeholder="Label (e.g. Warehouse)" className="input" />
            <input name="line1" placeholder="Address line 1" required className="input" />
            <input name="line2" placeholder="Address line 2" className="input" />
            <input name="suburb" placeholder="Suburb" className="input" />
            <input name="state" placeholder="State" className="input" />
            <input name="postcode" placeholder="Postcode" className="input" />
            <input name="country" placeholder="Country" defaultValue="Australia" className="input" />
            <SubmitButton className="self-start rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30 sm:col-span-2">
              + Add collection address
            </SubmitButton>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 section-title text-ink">Contact persons</h2>
        <ul className="mb-4 flex flex-col gap-2">
          {(contacts ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-ink/10 bg-white p-3 text-sm">
              <div>
                <span className="font-medium text-ink">{c.name}</span>
                {c.phone && <span className="ml-2 font-mono text-ink/60">{c.phone}</span>}
              </div>
              {canEdit && (
                <form action={removeContact}>
                  <input type="hidden" name="contact_id" value={c.id} />
                  <input type="hidden" name="vendor_id" value={vendor.id} />
                  <SubmitButton className="text-xs text-maroon/70 hover:underline">
                    remove
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
          {(contacts ?? []).length === 0 && <li className="text-sm text-ink/50">None yet.</li>}
        </ul>

        {canEdit && (
          <form action={addContact} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="vendor_id" value={vendor.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Name</span>
              <input name="contact_name" required className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Phone</span>
              <input name="contact_phone" className="input" />
            </label>
            <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
              + Add contact
            </SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink/70">{label}</span>
      {children}
    </label>
  );
}
