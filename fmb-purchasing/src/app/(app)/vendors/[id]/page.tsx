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
} from "./actions";
import { reviewVendor } from "../actions";

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
    admin
      .from("payees")
      .select("id, bank_account_name, bank_bsb, bank_account_number, notes")
      .eq("vendor_id", id)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  if (!vendor) notFound();

  const stored = paymentRow.data?.[0];
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
          <span
            className={`text-sm ${
              vendor.status === "approved"
                ? "text-palm"
                : vendor.status === "rejected"
                  ? "text-maroon/70"
                  : "text-gold-deep"
            }`}
          >
            {vendor.status as string}
          </span>
        </div>

        {/* Deciding a vendor used to be possible only from the list, on a row
            showing a fraction of what is here. Whoever opens the record to
            check the ABN, the address and who it pays is the person in a
            position to approve it, so the decision belongs on the same page.
            Same action the list calls — one review path, not two. */}
        {canApprove && vendor.status === "pending" && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <form action={reviewVendor}>
              <input type="hidden" name="vendor_id" value={vendor.id} />
              <input type="hidden" name="decision" value="approved" />
              <SubmitButton className="rounded-md bg-palm px-4 py-2 text-sm font-medium text-white hover:bg-palm/90">
                Approve vendor
              </SubmitButton>
            </form>
            <form action={reviewVendor}>
              <input type="hidden" name="vendor_id" value={vendor.id} />
              <input type="hidden" name="decision" value="rejected" />
              <SubmitButton className="rounded-md border border-maroon/30 px-4 py-2 text-sm text-maroon/80 hover:bg-maroon/5">
                Reject
              </SubmitButton>
            </form>
          </div>
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
