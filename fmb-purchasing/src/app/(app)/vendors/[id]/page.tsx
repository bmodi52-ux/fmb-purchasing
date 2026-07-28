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
} from "./actions";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "vendors", "edit_master_data");

  const admin = createAdminClient();
  const [{ data: vendor }, { data: addresses }, { data: contacts }] = await Promise.all([
    admin.from("vendors").select("*").eq("id", id).maybeSingle(),
    admin.from("vendor_collection_addresses").select("*").eq("vendor_id", id).order("created_at"),
    admin.from("vendor_contacts").select("*").eq("vendor_id", id).order("created_at"),
  ]);

  if (!vendor) notFound();

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
        </div>
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
