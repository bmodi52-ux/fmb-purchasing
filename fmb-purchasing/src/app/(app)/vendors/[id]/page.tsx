import { SubmitButton } from "@/components/submit-button";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
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
  checkVendorRegistration,
} from "./actions";
import { reviewVendor } from "../actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import { ReviewDecision, StatusPill } from "@/components/review-decision";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { formatPackPrice, formatUnitCost, packTitle, priceFieldLabel } from "@/lib/pack-description";
import { allRows } from "@/lib/supabase/all-rows";
import { AddProductModal, type OfferableItem } from "./add-product-modal";
import { VendorProducts, type VendorProductRow } from "./vendor-products";

type VendorOfferRow = {
  id: string;
  status: string;
  brand: string | null;
  vendor_sku: string | null;
  pack_price: number | null;
  item_pack_sizes:
    | (PackRow & { items: { id: string; name: string; item_number: string | null; category_id: string | null } | null })
    | null;
};

type PackRow = {
  id: string;
  label: string | null;
  inner_quantity: number;
  inner_unit_id: string;
  pack_count: number;
  sold_loose: boolean;
  packaging: string | null;
};

type Vendor = {
  id: string;
  name: string;
  abn: string | null;
  vendor_number: string | null;
  status: string;
  billing_address: Record<string, string | null> | null;
  gst_registered: boolean | null;
  gst_registered_from: string | null;
  abn_active: boolean | null;
  abr_checked_at: string | null;
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient()
    .from("vendors")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (data?.name as string | null) ?? "Vendor" };
}

/**
 * One vendor, in two tabs: its own record, and what it supplies.
 *
 * Both lived on one long page — bank details and contact phone numbers above a
 * product list that keeps growing — so whoever came for one scrolled past the
 * other. A tab is its own address (?tab=products), so a link can open straight
 * onto a vendor's products, and each tab only loads what it shows.
 */
export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "vendors", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const showProducts = tab === "products";

  const admin = createAdminClient();
  const [{ data: vendor }, { count: productCount }] = await Promise.all([
    admin
      .from("vendors")
      .select(
        "id, name, abn, vendor_number, status, billing_address, gst_registered, gst_registered_from, abn_active, abr_checked_at"
      )
      .eq("id", id)
      .maybeSingle<Vendor>(),
    admin
      .from("pricelist_items")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", id)
      .neq("status", "rejected"),
  ]);

  if (!vendor) notFound();

  const canApproveVendor = can(permissions, "vendors", "approve_master_data");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/vendors" className="text-sm text-ink/50 hover:text-ink">
          ← Vendors
        </Link>
        {/* Wraps so a long vendor name doesn't squeeze the reference code
            against the edge on a narrow screen. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{vendor.name}</h1>
          <span className="font-mono text-sm text-ink/50">{vendor.vendor_number}</span>
          <StatusPill status={vendor.status} />
        </div>

        {canApproveVendor && vendor.status === "pending" && (
          <ReviewDecision
            action={reviewVendor}
            idField="vendor_id"
            id={vendor.id}
            approveLabel="Approve vendor"
            note="Approving lets receipts be filed against this vendor without a second look."
          />
        )}

        <nav aria-label="Vendor sections" className="mt-5 flex gap-1 border-b border-ink/10">
          <TabLink href={`/vendors/${vendor.id}`} active={!showProducts}>
            Details
          </TabLink>
          <TabLink href={`/vendors/${vendor.id}?tab=products`} active={showProducts}>
            Products <span className="ml-1 text-xs text-ink/45">{productCount ?? 0}</span>
          </TabLink>
        </nav>
      </div>

      {showProducts ? (
        <ProductsTab
          vendor={vendor}
          canViewPricelist={can(permissions, "pricelist", "view")}
          canEditPricelist={can(permissions, "pricelist", "edit_master_data")}
          canApprovePricelist={can(permissions, "pricelist", "approve_master_data")}
          canSubmit={can(permissions, "submit_expense", "submit")}
        />
      ) : (
        <DetailsTab
          vendor={vendor}
          canEdit={can(permissions, "vendors", "edit_master_data")}
          // The trust boundary 0027 drew: bank details belong to whoever
          // transfers the money, not to everyone who can read a vendor record.
          canSeeBankDetails={can(permissions, "payments", "mark_paid")}
        />
      )}
    </div>
  );
}

function registrationSummary(v: Vendor): string {
  if (!v.abr_checked_at) return "GST registration not checked with the ABR yet.";
  const checked = `checked ${formatDate(v.abr_checked_at)}`;
  if (v.abn_active === false) return `The ABR lists this ABN as cancelled — ${checked}.`;
  if (v.gst_registered === true) {
    return `Registered for GST${v.gst_registered_from ? ` since ${formatPlainDate(v.gst_registered_from)}` : ""} — ${checked}.`;
  }
  if (v.gst_registered === false) return `Not registered for GST, so it shouldn't charge GST — ${checked}.`;
  return `The ABR didn't say whether this business is registered for GST — ${checked}.`;
}

function registrationTone(v: Vendor): string {
  return v.abn_active === false || v.gst_registered === false ? "text-maroon" : "text-ink/60";
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
        active ? "border-gold-deep font-medium text-ink" : "border-transparent text-ink/60 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

async function DetailsTab({
  vendor,
  canEdit,
  canSeeBankDetails,
}: {
  vendor: Vendor;
  canEdit: boolean;
  canSeeBankDetails: boolean;
}) {
  const admin = createAdminClient();
  const [{ data: addresses }, { data: contacts }, paymentRow] = await Promise.all([
    admin.from("vendor_collection_addresses").select("*").eq("vendor_id", vendor.id).order("created_at"),
    admin.from("vendor_contacts").select("*").eq("vendor_id", vendor.id).order("created_at"),
    // Every account this vendor has ever had, newest first: the one in use,
    // anything a submitter has proposed off an invoice, and the ones they
    // replaced. See migration 0037.
    admin
      .from("payees")
      .select("id, bank_account_name, bank_bsb, bank_account_number, notes, status, created_at, superseded_at")
      .eq("vendor_id", vendor.id)
      .order("created_at", { ascending: false }),
  ]);

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

  const billing = vendor.billing_address ?? {};

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 section-title text-ink">Details</h2>
        <form action={updateVendorDetails} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="hidden" name="vendor_id" value={vendor.id} />
          <Field label="Vendor name">
            <input name="name" defaultValue={vendor.name} disabled={!canEdit} required className="input" />
          </Field>
          <Field label="ABN">
            <input name="abn" defaultValue={vendor.abn ?? ""} disabled={!canEdit} className="input" />
          </Field>

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink/70">Billing address</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        {/* What the ABR says, kept current by incoming expenses (#30). Its own
            form, since forms cannot nest. */}
        {vendor.abn && (
          <div className="mt-5 flex flex-col gap-2 border-t border-ink/10 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className={registrationTone(vendor)}>{registrationSummary(vendor)}</p>
            {canEdit && (
              <form action={checkVendorRegistration}>
                <input type="hidden" name="vendor_id" value={vendor.id} />
                <SubmitButton
                  pendingLabel="Checking…"
                  className="whitespace-nowrap rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/70 hover:border-ink/30"
                >
                  Check with the ABR
                </SubmitButton>
              </form>
            )}
          </div>
        )}
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
          <form action={updateVendorPaymentDetails} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <form action={addCollectionAddress} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

async function ProductsTab({
  vendor,
  canViewPricelist,
  canEditPricelist,
  canApprovePricelist,
  canSubmit,
}: {
  vendor: Vendor;
  canViewPricelist: boolean;
  canEditPricelist: boolean;
  canApprovePricelist: boolean;
  canSubmit: boolean;
}) {
  const admin = createAdminClient();
  const [{ data: offerRows }, { data: offerCosts }, { data: units }, { data: categories }] = await Promise.all([
    admin
      .from("pricelist_items")
      .select(
        "id, status, brand, vendor_sku, pack_price, item_pack_sizes ( id, label, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging, items ( id, name, item_number, category_id ) )"
      )
      .eq("vendor_id", vendor.id)
      .returns<VendorOfferRow[]>(),
    admin.from("offer_unit_costs").select("offer_id, cost_per_base_unit, base_unit_code").eq("vendor_id", vendor.id),
    admin.from("units").select("id, code, label").order("sort_order"),
    admin.from("categories").select("id, name, parent_category_id, code").order("sort_order"),
  ]);

  const unitLabelById = new Map((units ?? []).map((u) => [u.id as string, u.label as string]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const shapeOf = (p: PackRow) => ({
    innerQuantity: p.inner_quantity,
    unitLabel: unitLabelById.get(p.inner_unit_id),
    packCount: p.pack_count,
    soldLoose: p.sold_loose,
    packaging: p.packaging,
  });

  const vendorOffers = (offerRows ?? []).filter((o) => o.item_pack_sizes?.items);
  const offerIds = vendorOffers.map((o) => o.id);

  // How often each offer has actually been bought, when last, and what one
  // pack cost that time — declined expenses are not purchases.
  const { data: usageRows } = offerIds.length
    ? await admin
        .from("expense_line_items")
        .select("pricelist_item_id, line_total, quantity, expenses!inner ( receipt_date, status, created_at )")
        .in("pricelist_item_id", offerIds)
        .not("expenses.status", "in", NOT_SPEND_FILTER)
    : { data: [] };

  type Purchase = { lineTotal: number; quantity: number | null; date: string | null; submitted: string };
  const purchasesByOffer = new Map<string, Purchase[]>();
  for (const row of (usageRows ?? []) as unknown as {
    pricelist_item_id: string;
    line_total: number;
    quantity: number | null;
    expenses: { receipt_date: string | null; created_at: string } | null;
  }[]) {
    const list = purchasesByOffer.get(row.pricelist_item_id) ?? [];
    list.push({
      lineTotal: Number(row.line_total),
      quantity: row.quantity != null ? Number(row.quantity) : null,
      date: row.expenses?.receipt_date ?? null,
      submitted: row.expenses?.created_at ?? "",
    });
    purchasesByOffer.set(row.pricelist_item_id, list);
  }

  const costByOffer = new Map(
    (offerCosts ?? []).map((c) => [c.offer_id as string, c as { cost_per_base_unit: number | null; base_unit_code: string }])
  );

  const productRows: VendorProductRow[] = vendorOffers.map((o) => {
    const pack = o.item_pack_sizes!;
    const item = pack.items!;
    const shape = shapeOf(pack);
    const cost = costByOffer.get(o.id);
    const purchases = [...(purchasesByOffer.get(o.id) ?? [])].sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.submitted.localeCompare(a.submitted)
    );
    const latest = purchases.find((p) => p.quantity && p.quantity > 0 && p.lineTotal > 0);
    const lastPaidPrice = latest ? Math.round((latest.lineTotal / latest.quantity!) * 100) / 100 : null;
    return {
      offerId: o.id,
      status: o.status,
      itemId: item.id,
      itemName: item.name,
      itemNumber: item.item_number,
      categoryName: item.category_id ? (categoryNameById.get(item.category_id) ?? null) : null,
      packTitle: packTitle(pack.label, shape),
      price: o.pack_price != null ? formatPackPrice(Number(o.pack_price), shape) : null,
      packPrice: o.pack_price != null ? Number(o.pack_price) : null,
      priceLabel: priceFieldLabel(shape),
      perUnit:
        cost?.cost_per_base_unit != null ? formatUnitCost(Number(cost.cost_per_base_unit), cost.base_unit_code) : null,
      brand: o.brand,
      vendorSku: o.vendor_sku,
      purchaseCount: purchases.length,
      lastBought: purchases[0]?.date ? formatPlainDate(purchases[0].date) : null,
      lastPaid:
        lastPaidPrice != null
          ? {
              price: lastPaidPrice,
              text: `${formatPackPrice(lastPaidPrice, shape)}${latest?.date ? ` on ${formatPlainDate(latest.date)}` : ""}`,
            }
          : null,
    };
  });

  // Everything that could be priced for this vendor, for whoever may add
  // pricing. The whole Pricelist, paged, because a vendor can be offered any
  // item on it.
  let offerableItems: OfferableItem[] = [];
  let assignableCategories: { id: string; name: string }[] = [];
  if (canEditPricelist) {
    const pricedPackIds = new Set(
      vendorOffers.filter((o) => o.status !== "rejected").map((o) => o.item_pack_sizes!.id)
    );
    const [itemRows, packRows] = await Promise.all([
      allRows<{ id: string; name: string; item_number: string | null; category_id: string | null }>((from, to) =>
        admin
          .from("items")
          .select("id, name, item_number, category_id")
          .neq("status", "rejected")
          .order("name")
          .order("id")
          .range(from, to)
      ),
      allRows<PackRow & { item_id: string }>((from, to) =>
        admin
          .from("item_pack_sizes")
          .select("id, item_id, label, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging")
          .order("id")
          .range(from, to)
      ),
    ]);

    assignableCategories = leafCategories(sortCategories(categories ?? [])).map((c) => ({
      id: c.id,
      name: categoryNameById.get(c.id) ?? c.name,
    }));

    const packsByItem = new Map<string, (PackRow & { item_id: string })[]>();
    for (const p of packRows) packsByItem.set(p.item_id, [...(packsByItem.get(p.item_id) ?? []), p]);

    offerableItems = itemRows.map((i) => ({
      id: i.id,
      name: i.name,
      itemNumber: i.item_number,
      categoryName: i.category_id ? (categoryNameById.get(i.category_id) ?? null) : null,
      packs: (packsByItem.get(i.id) ?? [])
        .map((p) => ({
          id: p.id,
          title: packTitle(p.label, shapeOf(p)),
          priceLabel: priceFieldLabel(shapeOf(p)),
          totalQuantity: Number(p.inner_quantity) * Number(p.pack_count),
          unitLabel: unitLabelById.get(p.inner_unit_id) ?? null,
          alreadyPriced: pricedPackIds.has(p.id),
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }

  const actions =
    canEditPricelist || canSubmit ? (
      <>
        {canEditPricelist && (
          <AddProductModal
            vendorId={vendor.id}
            vendorName={vendor.name}
            items={offerableItems}
            categories={assignableCategories}
            units={units ?? []}
          />
        )}
        {canSubmit && (
          <Link
            href={`/pricelist/add-by-photo?vendor=${vendor.id}`}
            className="self-start whitespace-nowrap rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink transition-colors hover:border-ink/30"
          >
            Add by photo
          </Link>
        )}
      </>
    ) : null;

  return (
    <VendorProducts
      vendorId={vendor.id}
      vendorName={vendor.name}
      rows={productRows}
      canViewPricelist={canViewPricelist}
      canApprove={canApprovePricelist}
      canEdit={canEditPricelist}
      actions={actions}
    />
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
