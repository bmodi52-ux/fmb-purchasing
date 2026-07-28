import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { AddVendorModal } from "./add-vendor-modal";
import { VendorsTable, type VendorRow } from "./vendors-table";

const PAGE_KEY = "vendors";
const DEFAULT_VISIBLE = ["vendor_number", "name", "abn", "billing_address", "contact", "status", "actions"];

export default async function VendorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "vendors", "edit_master_data");
  const canApprove = can(permissions, "vendors", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: vendors }, { data: contacts }, visibleColumns] = await Promise.all([
    admin
      .from("vendors")
      .select("id, vendor_number, name, abn, status, billing_address")
      .order("status")
      .order("name"),
    admin.from("vendor_contacts").select("vendor_id, name, phone"),
    getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
  ]);

  const contactsByVendor = new Map<string, { name: string; phone: string | null }[]>();
  for (const c of contacts ?? []) {
    const list = contactsByVendor.get(c.vendor_id) ?? [];
    list.push({ name: c.name, phone: c.phone });
    contactsByVendor.set(c.vendor_id, list);
  }

  const rows: VendorRow[] = (vendors ?? []).map((v) => {
    const billing = v.billing_address as Record<string, string | null> | null;
    const vendorContacts = contactsByVendor.get(v.id) ?? [];
    const primaryContact = vendorContacts[0];
    return {
      id: v.id,
      vendor_number: v.vendor_number,
      name: v.name,
      abn: v.abn,
      status: v.status,
      billingSummary: billing ? [billing.suburb, billing.state].filter(Boolean).join(", ") : "",
      contactSummary: primaryContact
        ? `${primaryContact.name}${primaryContact.phone ? ` · ${primaryContact.phone}` : ""}${
            vendorContacts.length > 1 ? ` (+${vendorContacts.length - 1})` : ""
          }`
        : "",
    };
  });

  const pending = rows.filter((v) => v.status === "pending");
  const rest = rows.filter((v) => v.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      {/* Stacked on phones: side by side, the action button gets squeezed to
          roughly its own width and wraps mid-label. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="page-title text-ink">Vendors</h1>
          <p className="page-description mt-1 max-w-xl">
            Vendors typed or extracted on the submit form appear here as
            pending until reviewed — that never blocks the expense they came
            from. Click a vendor for billing address, collection addresses,
            and contacts.
          </p>
        </div>
        {canEdit && <AddVendorModal />}
      </div>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 section-title text-ink">Pending review ({pending.length})</h2>
          <VendorsTable vendors={pending} canApprove={canApprove} initialVisible={visibleColumns} />
        </section>
      )}

      <section>
        <h2 className="mb-2 section-title text-ink">All vendors</h2>
        <VendorsTable vendors={rest} canApprove={canApprove} initialVisible={visibleColumns} emptyLabel="None." />
      </section>
    </div>
  );
}
