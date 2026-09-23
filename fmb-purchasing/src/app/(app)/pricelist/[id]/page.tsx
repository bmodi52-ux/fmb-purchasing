import { SubmitButton } from "@/components/submit-button";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import {
  updateItem,
  addPackSize,
  removePackSize,
  addOffer,
  updateOffer,
  reviewOffer,
  reviewItem,
  deleteOffer,
  retireOffer,
  addVendorItemDescription,
  removeVendorItemDescription,
} from "../actions";
import { ReviewDecision, StatusPill } from "@/components/review-decision";
import { OfferForm } from "./offer-form";
import { PackSizeForm } from "./pack-size-form";
import { PackFields } from "../pack-fields";
import {
  formatPackPrice,
  formatUnitCost,
  packTitle,
  priceFieldLabel,
  unitName,
  unitOptionLabel,
} from "@/lib/pack-description";
import { summarisePackPrices } from "@/lib/pack-prices";
import { MergePanel, type DuplicateCandidate } from "./merge-panel";
import { MoveOfferPanel } from "./move-offer-panel";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { BuyingForm } from "./buying-form";
import { getSetting } from "@/lib/app-settings";
import { limitsFor } from "@/lib/price-alerts";
import { loadCheapestRecent } from "@/lib/price-alerts-data";
import { todayIso } from "@/lib/periods-data";
import { formatPlainDate } from "@/lib/format";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { TabLink } from "@/components/tab-link";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { describeSources, type DescriptionSource } from "@/lib/description-sources";
import { getColumnPreference } from "@/lib/column-prefs";
import { PurchasesTable, PURCHASES_DEFAULT_VISIBLE } from "./purchases-table";
import { loadPurchaseRows } from "./purchases-data";

const ITEM_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category_id: "Category",
  canonical_unit_id: "Measured in",
  comments: "Comments",
  // Pack size edits are written to the item's history too.
  label: "Pack name",
  packaging: "Pack comes as",
  inner_quantity: "Pack holds",
  inner_unit_id: "Pack unit",
  pack_count: "Smaller packs inside",
  sold_loose: "Bought loose",
  contents_confirmed: "Pack contents confirmed",
  preferred_vendor_id: "Preferred vendor",
  price_rise_percent: "Alert on a rise over (%)",
  price_fall_percent: "Alert on a fall over (%)",
  expected_min_per_unit: "Expected price from",
  expected_max_per_unit: "Expected price up to",
  offer_moved_out: "Vendor offer moved to",
  offer_moved_in: "Vendor offer moved here from",
};

const OFFER_FIELD_LABELS: Record<string, string> = {
  vendor_id: "Vendor",
  brand: "Brand",
  vendor_sku: "Vendor's product code",
  pack_size_id: "Pack size",
  pack_price: "Pack price",
  status: "Status",
  comments: "Comments",
  // retained so history written before 0009 still reads sensibly
  unit_price: "Unit price",
  unit_price_unit_id: "Unit price unit",
  per_unit_cost: "Per-unit cost",
  per_unit_cost_unit_id: "Per-unit cost unit",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient()
    .from("items")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (data?.name as string | null) ?? "Item" };
}

type ItemTab = "overview" | "purchases" | "settings" | "history";

/**
 * One item, in three tabs (#53): Overview is what people come for day to day —
 * what it costs and who sells it — Settings is the setup that is changed
 * rarely, and History is the record of changes.
 *
 * Seven sections on one page read as cluttered, and the Details form sat on
 * top of everything although it is the part least often touched. Each tab is
 * its own address (?tab=settings), as on a vendor's page, so a link can open
 * the right one.
 */
export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  const tab: ItemTab =
    tabParam === "purchases" || tabParam === "settings" || tabParam === "history" ? tabParam : "overview";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "view");

  const permissions = await getUserPermissions(user);
  const canEdit = can(permissions, "pricelist", "edit_master_data");
  const canApprove = can(permissions, "pricelist", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: item }, { data: vendors }, { data: categories }, { data: units }, { data: packSizes }, { data: itemHistory }] =
    await Promise.all([
      admin.from("items").select("*").eq("id", id).maybeSingle(),
      admin.from("vendors").select("id, name, vendor_number").order("name"),
      admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
      admin.from("units").select("id, code, label, base_unit_code").order("sort_order"),
      admin.from("item_pack_sizes").select("*").eq("item_id", id).order("total_quantity"),
      admin.from("item_history").select("id, changed_at, changed_by, changes").eq("item_id", id).order("changed_at", { ascending: false }),
    ]);

  if (!item) notFound();

  const packSizeIds = (packSizes ?? []).map((p) => p.id);
  const [{ data: offers }, { data: offerHistoryRows }, { data: offerCosts }, { data: itemCost }] = await Promise.all([
    packSizeIds.length
      ? admin.from("pricelist_items").select("*").in("pack_size_id", packSizeIds).order("created_at")
      : Promise.resolve({ data: [] }),
    packSizeIds.length
      ? admin
          .from("pricelist_item_history")
          .select("id, item_id, changed_at, changed_by, changes")
          .order("changed_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from("offer_unit_costs").select("offer_id, cost_per_base_unit, base_unit_code").eq("item_id", id),
    admin
      .from("item_unit_costs")
      .select(
        "base_unit_code, purchase_count, vendor_count, avg_cost_per_base_unit, latest_cost_per_base_unit, latest_receipt_date, all_contents_confirmed"
      )
      .eq("item_id", id)
      .maybeSingle(),
  ]);

  // Buying (#29): the limits this item inherits, and the cheapest it has been
  // bought for lately.
  const priceSettings = await getSetting(admin, "price_alerts");
  const [{ data: itemCategory }, cheapest] = await Promise.all([
    item.category_id
      ? admin.from("categories").select("price_rise_percent, price_fall_percent").eq("id", item.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadCheapestRecent(admin, priceSettings.cheapestRecentDays, todayIso(), id),
  ]);
  const inheritedLimits = limitsFor(priceSettings, itemCategory, null);
  const cheapestRecent = cheapest.get(id) ?? null;

  const costByOfferId = new Map(
    (offerCosts ?? []).map((c) => [c.offer_id as string, c as { cost_per_base_unit: number | null; base_unit_code: string }])
  );

  // How many submitted purchases hang off each pack size / offer. Drives both
  // the "this will restate N purchases" warning when editing a pack size, and
  // whether an offer can still be deleted.
  const offerIdList = (offers ?? []).map((o) => o.id);
  const { data: usageRows } = offerIdList.length
    ? await admin.from("expense_line_items").select("id, pricelist_item_id").in("pricelist_item_id", offerIdList)
    : { data: [] };
  const purchasesByOffer = new Map<string, number>();
  for (const r of usageRows ?? []) {
    const key = r.pricelist_item_id as string;
    purchasesByOffer.set(key, (purchasesByOffer.get(key) ?? 0) + 1);
  }
  const purchasesByPackSize = new Map<string, number>();
  for (const o of offers ?? []) {
    const n = purchasesByOffer.get(o.id) ?? 0;
    if (n > 0) purchasesByPackSize.set(o.pack_size_id, (purchasesByPackSize.get(o.pack_size_id) ?? 0) + n);
  }

  // What each pack has cost per pack — per box, per bag — beside the per-kilo
  // figures item_unit_costs gives. The same purchases, divided differently.
  const packSizeByOfferId = new Map((offers ?? []).map((o) => [o.id as string, o.pack_size_id as string]));
  const packSizeByLineId = new Map<string, string>();
  for (const r of usageRows ?? []) {
    const packSizeId = packSizeByOfferId.get(r.pricelist_item_id as string);
    if (packSizeId) packSizeByLineId.set(r.id as string, packSizeId);
  }
  const { data: paidRows } = packSizeByLineId.size
    ? await admin
        .from("item_paid_unit_costs")
        .select("line_item_id, line_total, normalized_quantity, receipt_date, submitted_at")
        .eq("item_id", id)
    : { data: [] };
  const packPrices = summarisePackPrices(
    (paidRows ?? []).flatMap((r) => {
      const packSizeId = packSizeByLineId.get(r.line_item_id as string);
      return packSizeId
        ? [
            {
              packSizeId,
              lineTotal: Number(r.line_total),
              quantity: Number(r.normalized_quantity),
              receiptDate: (r.receipt_date as string | null) ?? null,
              submittedAt: r.submitted_at as string,
            },
          ]
        : [];
    })
  );

  const { data: duplicateRows } = await admin
    .from("item_duplicate_candidates")
    .select("candidate_id, candidate_name, candidate_item_number, candidate_category_id, score")
    .eq("item_id", id)
    .order("score", { ascending: false })
    .limit(5);

  const { data: vendorDescriptions } = await admin
    .from("vendor_item_descriptions")
    .select("id, vendor_id, description, created_at, created_by")
    .eq("item_id", id)
    .order("created_at");

  // Where each description came from (#55): the expense lines filed against
  // this item that say the same thing. Only Settings shows descriptions.
  const { data: describedLines } =
    tab === "settings" && offerIdList.length > 0 && (vendorDescriptions ?? []).length > 0
      ? await admin
          .from("expense_line_items")
          .select("description_raw, expense_id, expenses!inner(expense_number, vendor_id, receipt_date, created_at, submitted_by)")
          .in("pricelist_item_id", offerIdList)
      : { data: [] };
  type DescribedExpense = {
    expense_number: string | null;
    vendor_id: string | null;
    receipt_date: string | null;
    created_at: string | null;
    submitted_by: string;
  };
  const expenseByLine = (describedLines ?? []).map((l) => ({
    line: l,
    expense: (Array.isArray(l.expenses) ? l.expenses[0] : l.expenses) as DescribedExpense,
  }));
  const descriptionSources = describeSources(
    (vendorDescriptions ?? []).map((d) => ({
      id: d.id as string,
      vendorId: (d.vendor_id as string | null) ?? null,
      description: d.description as string,
      createdAt: d.created_at as string,
      createdBy: (d.created_by as string | null) ?? null,
    })),
    expenseByLine.map(({ line, expense }) => ({
      expenseId: line.expense_id as string,
      expenseNumber: expense.expense_number,
      vendorId: expense.vendor_id,
      description: line.description_raw as string,
      date: expense.receipt_date ?? expense.created_at,
    })),
    (itemHistory ?? []).flatMap((h) => {
      const name = (h.changes as Record<string, { old: unknown; new: unknown }>).name;
      return name ? [{ oldName: String(name.old ?? ""), newName: String(name.new ?? ""), changedAt: h.changed_at as string }] : [];
    })
  );
  // The receipt behind an expense is only for those who may see the expense.
  const seesAllExpenses =
    can(permissions, "all_expenses", "view") || can(permissions, "approvals", "approve") || can(permissions, "payments", "mark_paid");
  const submitterByExpense = new Map(expenseByLine.map(({ line, expense }) => [line.expense_id as string, expense.submitted_by]));
  const canOpenExpense = (expenseId: string) => seesAllExpenses || submitterByExpense.get(expenseId) === user.id;
  const sourceExpenseIds = [
    ...new Set(
      [...descriptionSources.values()].flatMap((s) => (s.kind === "receipt" && canOpenExpense(s.latest.expenseId) ? [s.latest.expenseId] : []))
    ),
  ];
  const { data: sourceAttachments } = sourceExpenseIds.length
    ? await admin.from("expense_attachments").select("expense_id").in("expense_id", sourceExpenseIds)
    : { data: [] };
  const expensesWithReceipt = new Set((sourceAttachments ?? []).map((a) => a.expense_id as string));

  const offerIds = new Set((offers ?? []).map((o) => o.id));
  const offerHistory = (offerHistoryRows ?? []).filter((h) => offerIds.has(h.item_id));

  const changedByIds = [
    ...new Set(
      [
        ...(itemHistory ?? []).map((h) => h.changed_by),
        ...offerHistory.map((h) => h.changed_by),
        ...(vendorDescriptions ?? []).map((d) => d.created_by),
      ].filter(Boolean)
    ),
  ];
  const { data: profiles } =
    changedByIds.length > 0
      ? await admin.from("profiles").select("id, full_name, email").in("id", changedByIds)
      : { data: [] };
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  const vendorNameById = new Map((vendors ?? []).map((v) => [v.id, `${v.vendor_number} — ${v.name}`]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));
  const canonicalUnitLabel = unitLabelById.get(item.canonical_unit_id) ?? null;

  const assignableCategories = leafCategories(sortCategories(categories ?? []));
  const currentCategory = (categories ?? []).find((c) => c.id === item.category_id);
  const categoryOptions =
    currentCategory && !assignableCategories.some((c) => c.id === currentCategory.id)
      ? [...assignableCategories, currentCategory]
      : assignableCategories;
  const packShapeOf = (p: {
    inner_quantity: number;
    inner_unit_id: string;
    pack_count: number;
    sold_loose?: boolean;
    packaging?: string | null;
  }) => ({
    innerQuantity: p.inner_quantity,
    unitLabel: unitLabelById.get(p.inner_unit_id),
    packCount: p.pack_count,
    soldLoose: p.sold_loose,
    packaging: p.packaging,
  });

  const packSizeLabelById = new Map((packSizes ?? []).map((p) => [p.id, packTitle(p.label, packShapeOf(p))]));

  // Purchases (#80): the lines behind the figures, only loaded on that tab.
  const [purchaseRows, purchaseColumns] =
    tab === "purchases"
      ? await Promise.all([
          loadPurchaseRows(admin, {
            itemId: item.id,
            offers: offers ?? [],
            packLabelByOfferId: new Map(
              (offers ?? []).map((o) => [o.id as string, packSizeLabelById.get(o.pack_size_id) ?? "—"])
            ),
            canOpenExpense: (_expenseId, submittedBy) => seesAllExpenses || submittedBy === user.id,
          }),
          getColumnPreference(user.id, "item_purchases", PURCHASES_DEFAULT_VISIBLE),
        ])
      : [[], []];

  function itemDisplayValue(field: string, value: unknown): string {
    if (value == null || value === "") return "—";
    if (field === "category_id") return categoryNameById.get(String(value)) ?? "—";
    if (field === "preferred_vendor_id") return vendorNameById.get(String(value)) ?? "a removed vendor";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (field === "canonical_unit_id" || field === "inner_unit_id") {
      const label = unitLabelById.get(String(value));
      return label ? unitOptionLabel(label) : "—";
    }
    return String(value);
  }

  function offerDisplayValue(field: string, value: unknown): string {
    if (value == null || value === "") return "—";
    if (field === "vendor_id") return vendorNameById.get(String(value)) ?? "—";
    if (field === "pack_size_id") return packSizeLabelById.get(String(value)) ?? "a pack on another item";
    if (field.endsWith("_unit_id")) return unitLabelById.get(String(value)) ?? "—";
    return String(value);
  }

  const duplicateCandidates: DuplicateCandidate[] = (duplicateRows ?? []).map((d) => ({
    id: d.candidate_id as string,
    itemNumber: (d.candidate_item_number as string | null) ?? null,
    name: d.candidate_name as string,
    categoryLabel: d.candidate_category_id ? (categoryNameById.get(d.candidate_category_id as string) ?? null) : null,
    score: Number(d.score),
  }));

  const updatedByName = item.updated_by ? profileNameById.get(item.updated_by) : null;
  const offersByPackSize = new Map<string, typeof offers>();
  for (const o of offers ?? []) {
    const list = offersByPackSize.get(o.pack_size_id) ?? [];
    list.push(o);
    offersByPackSize.set(o.pack_size_id, list);
  }
  const historyByOffer = new Map<string, typeof offerHistory>();
  for (const h of offerHistory) {
    const list = historyByOffer.get(h.item_id) ?? [];
    list.push(h);
    historyByOffer.set(h.item_id, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/pricelist" className="text-sm text-ink/50 hover:text-ink">
          ← Pricelist
        </Link>
        {/* Wraps so a long item name doesn't squeeze the reference code
            against the edge on a narrow screen. */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{item.name}</h1>
          <span className="tabular-nums text-sm text-ink/50">{item.item_number}</span>
          <StatusPill status={item.status as string} />
        </div>
        <p className="mt-1 text-sm text-ink/50">
          {updatedByName
            ? `Last updated ${formatDateTime(item.updated_at)} by ${updatedByName}`
            : `Created ${formatDateTime(item.created_at)}`}
        </p>

        {/* An item a receipt created is pending, and nothing ever said so or
            offered to change it — approval only ever happened as a side effect
            of approving one of its offers, so an item with none stayed pending
            for good. */}
        {canApprove && item.status === "pending" && (
          <ReviewDecision
            action={reviewItem}
            idField="item_id"
            id={item.id}
            approveLabel="Approve item"
            note="Approving confirms this is a real product worth keeping in the catalogue. Rejecting keeps it for the expenses that already name it, but marks it as one nobody should file against."
          />
        )}

        {/* What the Details form holds, read at a glance — the form itself
            is on Settings. */}
        <p className="mt-3 text-sm text-ink/70">
          {item.category_id ? (categoryNameById.get(item.category_id) ?? "Uncategorised") : "Uncategorised"}
          <span className="text-ink/30"> · </span>
          Measured in {canonicalUnitLabel ? unitOptionLabel(canonicalUnitLabel) : "—"}
        </p>
        {item.comments && <p className="mt-1 whitespace-pre-line text-sm text-ink/55">{item.comments}</p>}

        <nav aria-label="Item sections" className="tabs mt-5">
          <TabLink href={`/pricelist/${item.id}`} active={tab === "overview"}>
            Overview
          </TabLink>
          <TabLink href={`/pricelist/${item.id}?tab=purchases`} active={tab === "purchases"}>
            Purchases
          </TabLink>
          <TabLink href={`/pricelist/${item.id}?tab=settings`} active={tab === "settings"}>
            Settings
          </TabLink>
          <TabLink href={`/pricelist/${item.id}?tab=history`} active={tab === "history"}>
            History <span className="ml-1 text-xs text-ink/45">{(itemHistory ?? []).length}</span>
          </TabLink>
        </nav>
      </div>

      {tab === "purchases" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-ink/50">
            Every receipt line filed against this item, newest first — what was bought, from whom, and what it came to.
            The entry number opens the expense.
          </p>
          <PurchasesTable rows={purchaseRows} initialVisible={purchaseColumns} />
        </section>
      )}

      {tab === "settings" && (
        <>
      <section className="card p-5">
        <h2 className="mb-4 section-title text-ink">Details</h2>
        <form action={updateItem} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormResetBoundary>
          <input type="hidden" name="item_id" value={item.id} />
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">Item name</span>
            <input name="name" defaultValue={item.name} disabled={!canEdit} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Item category</span>
            <select name="category_id" defaultValue={item.category_id ?? ""} disabled={!canEdit} className="input">
              <option value="">—</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryNameById.get(c.id) ?? c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Measured in</span>
            <select
              name="canonical_unit_id"
              defaultValue={item.canonical_unit_id}
              disabled={!canEdit}
              required
              className="input"
            >
              {(units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {unitOptionLabel(u.label)}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink/45">
              Prices show per box or pack, and per this unit — e.g. kg for vegetables, L for milk, item for roti
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">Comments</span>
            <textarea name="comments" defaultValue={item.comments ?? ""} disabled={!canEdit} rows={2} className="input" />
          </label>
          </FormResetBoundary>
          {canEdit && (
            <SubmitButton className="btn btn-primary btn-lg self-start sm:col-span-2">
              Save changes
            </SubmitButton>
          )}
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 section-title text-ink">Buying</h2>
        <p className="mb-4 text-sm text-ink/50">
          {cheapestRecent
            ? `Cheapest in the last ${priceSettings.cheapestRecentDays} days: ${formatUnitCost(cheapestRecent.costPerUnit, cheapestRecent.unit, { decimals: 2 })}${
                cheapestRecent.vendorId ? ` from ${vendorNameById.get(cheapestRecent.vendorId) ?? "a vendor"}` : ""
              } on ${formatPlainDate(cheapestRecent.date)}.`
            : `Not bought in the last ${priceSettings.cheapestRecentDays} days with its pack contents confirmed.`}
        </p>
        <BuyingForm
          itemId={item.id}
          canEdit={canEdit}
          vendors={(vendors ?? []).map((v) => ({ id: v.id as string, name: v.name as string }))}
          values={{
            preferredVendorId: (item.preferred_vendor_id as string | null) ?? null,
            risePercent: item.price_rise_percent == null ? "" : String(Number(item.price_rise_percent)),
            fallPercent: item.price_fall_percent == null ? "" : String(Number(item.price_fall_percent)),
            expectedMin: item.expected_min_per_unit == null ? "" : String(Number(item.expected_min_per_unit)),
            expectedMax: item.expected_max_per_unit == null ? "" : String(Number(item.expected_max_per_unit)),
          }}
          inherited={{
            rise: inheritedLimits.rise,
            fall: inheritedLimits.fall,
            from: inheritedLimits.riseFrom === inheritedLimits.fallFrom ? (inheritedLimits.riseFrom === "category" ? "category" : "pricelist") : "mixed",
          }}
          unitName={unitName(
            itemCost?.base_unit_code ??
              ((units ?? []).find((u) => u.id === item.canonical_unit_id)?.base_unit_code as string | undefined) ??
              "each"
          )}
        />
      </section>
        </>
      )}

      {tab === "overview" && (
        <>
      <section className="card p-5">
        <h2 className="mb-1 section-title text-ink">What we&apos;ve actually paid</h2>
        <p className="mb-4 text-sm text-ink/50">
          Derived from submitted receipts rather than quoted pricelist prices — this is the figure that will cost a
          Thaali.
        </p>
        {itemCost ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label={`Most recent, per ${unitName(itemCost.base_unit_code)}`}
              value={formatUnitCost(Number(itemCost.latest_cost_per_base_unit), itemCost.base_unit_code)}
              note={itemCost.latest_receipt_date ? `as at ${itemCost.latest_receipt_date}` : null}
            />
            <Stat
              label={`Average paid, per ${unitName(itemCost.base_unit_code)}`}
              value={formatUnitCost(Number(itemCost.avg_cost_per_base_unit), itemCost.base_unit_code)}
              note={`across ${itemCost.vendor_count} vendor(s)`}
            />
            <Stat
              label="Purchases"
              value={String(itemCost.purchase_count)}
              note={
                <Link href={`/pricelist/${item.id}?tab=purchases`} className="underline hover:text-ink">
                  See each one
                </Link>
              }
            />
            {packPrices.size > 0 && (
              <div className="sm:col-span-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-ink/40">Per pack</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {(packSizes ?? [])
                    .filter((p) => packPrices.has(p.id))
                    .map((p) => {
                      const prices = packPrices.get(p.id)!;
                      const shape = packShapeOf(p);
                      return (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-md border border-ink/10 bg-white px-3 py-2"
                        >
                          <span className="text-ink">{packSizeLabelById.get(p.id)}</span>
                          <span className="tabular-nums text-ink/70">
                            most recent {formatPackPrice(prices.latest, shape)} · average{" "}
                            {formatPackPrice(prices.average, shape)}
                            <span className="ml-2 text-ink/40">
                              ({prices.purchaseCount} {prices.purchaseCount === 1 ? "purchase" : "purchases"})
                            </span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}
            {!itemCost.all_contents_confirmed && (
              <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-ink/80 sm:col-span-3">
                <strong>Provisional.</strong> At least one purchase is against a pack nobody has confirmed the contents
                of, so these figures are per <em>pack</em>, not per {unitName(itemCost.base_unit_code)}. Confirm
                what&apos;s in the pack below and they&apos;ll correct themselves.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink/50">
            No purchases recorded against this item yet — submit an expense and the cost per unit appears here.
          </p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 section-title text-ink">Pack sizes &amp; vendor offers</h2>
        <div className="flex flex-col gap-5">
          {(packSizes ?? []).map((p) => {
            const packOffers = offersByPackSize.get(p.id) ?? [];
            const liveOffers = packOffers.filter((o) => o.status !== "rejected");
            const rejectedOffers = packOffers.filter((o) => o.status === "rejected");
            const packUnitLabel = unitLabelById.get(p.inner_unit_id) ?? null;

            // One renderer for both lists below, so a rejected offer is
            // displayed exactly as a live one is — same actions, same
            // history. The disclosure is the only difference.
            const renderOffer = (o: (typeof packOffers)[number]) => {
              const history = historyByOffer.get(o.id) ?? [];
              const cost = costByOfferId.get(o.id);
              return (
                <li key={o.id} className="rounded-md border border-ink/10 bg-cream/60 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-ink">
                        {o.vendor_id ? vendorNameById.get(o.vendor_id) : "— no vendor —"}
                      </span>
                      {o.brand && <span className="ml-1 text-xs text-ink/40">({o.brand})</span>}
                      {o.vendor_sku && <span className="ml-1 tabular-nums text-xs text-ink/40">#{o.vendor_sku}</span>}
                      <OfferStatus status={o.status} />
                    </div>
                    <span className="tabular-nums text-ink/70">
                      {o.pack_price != null ? formatPackPrice(Number(o.pack_price), packShapeOf(p)) : "—"}
                      {cost?.cost_per_base_unit != null && (
                        <span className="ml-2 text-ink/50">
                          ({formatUnitCost(cost.cost_per_base_unit, cost.base_unit_code)})
                        </span>
                      )}
                    </span>
                  </div>
                  {o.comments && <p className="mt-1 text-ink/60">{o.comments}</p>}
                  {/* What a receipt filled in (#79) is only ever a reading of
                      the invoice, so it waits here to be checked. */}
                  {o.status === "pending" && (purchasesByOffer.get(o.id) ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-gold-deep">
                      Filled in from a receipt — check the pack, brand, product code and price
                      {canApprove ? ", then approve." : "."}
                    </p>
                  )}

                  {canApprove && o.status === "pending" && (
                    <div className="mt-2 flex gap-3">
                      <form action={reviewOffer}>
                        <input type="hidden" name="offer_id" value={o.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <SubmitButton className="btn btn-approve btn-xs">
                          Approve
                        </SubmitButton>
                      </form>
                      <form action={reviewOffer}>
                        <input type="hidden" name="offer_id" value={o.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <SubmitButton className="btn btn-danger btn-xs">
                          Reject
                        </SubmitButton>
                      </form>
                    </div>
                  )}

                  <div className="mt-2 flex gap-4 text-xs text-ink/50">
                    {canEdit && (
                      // Open when the offer is still missing something a
                      // person has to supply — a receipt now brings the
                      // price and the pack across, so an offer that
                      // still has neither is one nobody can approve
                      // without typing. Settled offers stay collapsed.
                      <details open={o.status === "pending" && (o.pack_price == null || !o.vendor_id)}>
                        <summary className="cursor-pointer hover:text-ink">
                          {o.status === "pending" && (o.pack_price == null || !o.vendor_id)
                            ? "Finish this offer"
                            : "Edit"}
                        </summary>
                        <div className="mt-2">
                          <OfferForm
                            action={updateOffer}
                            itemId={item.id}
                            packSizeId={p.id}
                            offerId={o.id}
                            priceLabel={priceFieldLabel(packShapeOf(p))}
                            totalQuantity={p.total_quantity}
                            innerUnitLabel={packUnitLabel}
                            vendorId={o.vendor_id}
                            brand={o.brand}
                            vendorSku={o.vendor_sku}
                            packPrice={o.pack_price}
                            comments={o.comments}
                            vendors={vendors ?? []}
                            packSizes={(packSizes ?? []).map((ps) => ({
                              id: ps.id,
                              label: packSizeLabelById.get(ps.id) ?? "",
                            }))}
                            submitLabel="Save"
                          />
                        </div>
                      </details>
                    )}
                    {canEdit && (purchasesByOffer.get(o.id) ?? 0) === 0 && (
                      <form action={deleteOffer}>
                        <input type="hidden" name="offer_id" value={o.id} />
                        <input type="hidden" name="item_id" value={item.id} />
                        <SubmitButton className="text-xs text-maroon/70 hover:underline">
                          Delete offer
                        </SubmitButton>
                      </form>
                    )}
                    {/* Delete would orphan the purchases, so an offer that has
                        some is retired instead: nothing new matches it, and
                        what it has keeps counting. A pending one an approver
                        can already reject. */}
                    {canEdit &&
                      (purchasesByOffer.get(o.id) ?? 0) > 0 &&
                      o.status !== "rejected" &&
                      !(canApprove && o.status === "pending") && (
                        <form action={retireOffer}>
                          <input type="hidden" name="offer_id" value={o.id} />
                          <input type="hidden" name="item_id" value={item.id} />
                          <SubmitButton className="text-xs text-maroon/70 hover:underline">Retire offer</SubmitButton>
                        </form>
                      )}
                    {canEdit && (
                      <MoveOfferPanel
                        offerId={o.id}
                        itemId={item.id}
                        offerLabel={`${o.vendor_id ? (vendorNameById.get(o.vendor_id) ?? "this vendor") : "this offer"}, ${packSizeLabelById.get(p.id) ?? ""}`}
                        purchaseCount={purchasesByOffer.get(o.id) ?? 0}
                      />
                    )}
                    <details>
                      <summary className="cursor-pointer hover:text-ink">History ({history.length})</summary>
                      {history.length === 0 ? (
                        <p className="mt-2">No changes recorded yet.</p>
                      ) : (
                        <ul className="mt-2 flex flex-col gap-2">
                          {history.map((h) => (
                            <li key={h.id} className="rounded border border-ink/10 bg-white p-2">
                              <p className="mb-1 text-ink/40">
                                {formatDateTime(h.changed_at)}
                                {h.changed_by && ` · ${profileNameById.get(h.changed_by) ?? "unknown"}`}
                              </p>
                              <ul>
                                {Object.entries(h.changes as Record<string, { old: unknown; new: unknown }>).map(
                                  ([field, diff]) => (
                                    <li key={field} className="text-ink/70">
                                      <span className="text-ink/40">{OFFER_FIELD_LABELS[field] ?? field}:</span>{" "}
                                      {offerDisplayValue(field, diff.old)} → {offerDisplayValue(field, diff.new)}
                                    </li>
                                  )
                                )}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </div>
                </li>
              );
            };

            return (
              <div key={p.id} className="rounded-md border border-ink/10 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">
                    {packTitle(p.label, packShapeOf(p))}
                    {!p.contents_confirmed && (
                      <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs font-normal text-gold-deep">
                        contents not confirmed
                      </span>
                    )}
                  </p>
                  {canEdit && packOffers.length === 0 && (
                    <form action={removePackSize}>
                      <input type="hidden" name="pack_size_id" value={p.id} />
                      <input type="hidden" name="item_id" value={item.id} />
                      <SubmitButton className="text-xs text-maroon/70 hover:underline">
                        remove
                      </SubmitButton>
                    </form>
                  )}
                </div>

                {canEdit && (
                  <details className="mb-3" open={!p.contents_confirmed}>
                    <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">
                      {p.contents_confirmed ? "Edit pack size" : "Confirm what's in this pack"}
                    </summary>
                    <div className="mt-2 rounded-md border border-ink/10 bg-cream/40 p-3">
                      <PackSizeForm
                        itemId={item.id}
                        packSizeId={p.id}
                        innerQuantity={p.inner_quantity}
                        innerUnitId={p.inner_unit_id}
                        packCount={p.pack_count}
                        label={p.label}
                        soldLoose={p.sold_loose}
                        packaging={p.packaging}
                        units={units ?? []}
                        purchaseCount={purchasesByPackSize.get(p.id) ?? 0}
                      />
                    </div>
                  </details>
                )}

                <ul className="flex flex-col gap-3">
                  {liveOffers.map(renderOffer)}
                  {liveOffers.length === 0 && (
                    <li className="text-sm text-ink/50">
                      {rejectedOffers.length > 0
                        ? "Every offer for this pack was rejected."
                        : "No vendor offers yet."}
                    </li>
                  )}
                </ul>

                {/* Rejected offers are kept, not deleted: they are a record
                    of a price somebody decided against, and the expense
                    lines that pointed at them still do. Collapsed, because
                    an item bought for years otherwise buries its live
                    offers under everything ever turned down. */}
                {rejectedOffers.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">
                      {rejectedOffers.length} rejected
                    </summary>
                    <ul className="mt-2 flex flex-col gap-3">{rejectedOffers.map(renderOffer)}</ul>
                  </details>
                )}

                {canEdit && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">+ Add vendor offer</summary>
                    <div className="mt-2">
                      <OfferForm
                        action={addOffer}
                        itemId={item.id}
                        packSizeId={p.id}
                        priceLabel={priceFieldLabel(packShapeOf(p))}
                        totalQuantity={p.total_quantity}
                        innerUnitLabel={packUnitLabel}
                        vendors={vendors ?? []}
                        submitLabel="+ Add offer"
                      />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
          {(packSizes ?? []).length === 0 && <p className="text-sm text-ink/50">No pack sizes yet.</p>}
        </div>

        {canEdit && (
          <form action={addPackSize} className="mt-5 flex flex-col gap-3 border-t border-ink/10 pt-4">
            <input type="hidden" name="item_id" value={item.id} />
            <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Add another pack size</p>
            <FormResetBoundary>
              <PackFields
                units={units ?? []}
                defaults={{ soldAs: "", innerQuantity: "1", innerUnitId: item.canonical_unit_id, packCount: "1" }}
              />
            </FormResetBoundary>
            <SubmitButton className="btn btn-secondary self-start">
              + Add pack size
            </SubmitButton>
          </form>
        )}
      </section>
        </>
      )}

      {tab === "settings" && (
        <>
      <section className="card p-5">
        <h2 className="mb-1 section-title text-ink">Vendor item descriptions</h2>
        <p className="mb-4 text-sm text-ink/50">
          What receipts call this item. A submitted receipt is matched here first, so this is how the item keeps
          matching after it&apos;s been renamed to something readable. Remove any wording that belongs to a different
          product — while it&apos;s listed, every receipt saying it will be filed against this item.
        </p>

        {(vendorDescriptions ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">
            None recorded yet. One is added automatically the first time a receipt line resolves to this item.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {(vendorDescriptions ?? []).map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-ink/10 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="break-words text-ink">{d.description}</p>
                  <p className="text-xs text-ink/45">
                    {d.vendor_id ? (vendorNameById.get(d.vendor_id) ?? "unknown vendor") : "Any vendor"}
                  </p>
                  <DescriptionSourceLine
                    source={descriptionSources.get(d.id)}
                    canOpenExpense={canOpenExpense}
                    hasReceipt={(expenseId) => expensesWithReceipt.has(expenseId)}
                    nameOf={(userId) => (userId ? (profileNameById.get(userId) ?? null) : null)}
                  />
                </div>
                {canEdit && (
                  <form action={removeVendorItemDescription}>
                    <input type="hidden" name="description_id" value={d.id} />
                    <input type="hidden" name="item_id" value={item.id} />
                    <SubmitButton className="shrink-0 text-xs text-maroon/70 hover:underline">remove</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <form
            action={addVendorItemDescription}
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4"
          >
            <input type="hidden" name="item_id" value={item.id} />
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">Description as it appears on the receipt</span>
              <input name="description" required placeholder="e.g. Bekaa Natural Set Yoghurt 5kg" className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Vendor (optional)</span>
              <select name="vendor_id" defaultValue="" className="input">
                <option value="">Any vendor</option>
                {(vendors ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className="btn btn-secondary">
              + Add description
            </SubmitButton>
          </form>
        )}
      </section>

      {canEdit && (
        <section className="card p-5">
          <h2 className="mb-1 section-title text-ink">Duplicates</h2>
          <p className="mb-4 text-sm text-ink/50">
            Receipts create a new item whenever the wording differs, so the same product can end up recorded twice with
            its price history split between them.
          </p>
          <MergePanel
            itemId={item.id}
            itemName={item.name}
            itemNumber={item.item_number}
            packSizeCount={(packSizes ?? []).length}
            offerCount={(offers ?? []).length}
            purchaseCount={itemCost?.purchase_count ?? 0}
            candidates={duplicateCandidates}
          />
        </section>
      )}
        </>
      )}

      {tab === "history" && (
      <section className="card p-5">
        <h2 className="mb-4 section-title text-ink">Item change history</h2>
        {(itemHistory ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">No changes recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {(itemHistory ?? []).map((h) => (
              <li key={h.id} className="rounded-md border border-ink/10 bg-white p-3">
                <p className="mb-1 text-xs text-ink/50">
                  {formatDateTime(h.changed_at)}
                  {h.changed_by && ` · ${profileNameById.get(h.changed_by) ?? "unknown"}`}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {Object.entries(h.changes as Record<string, { old: unknown; new: unknown }>).map(([field, diff]) => (
                    <li key={field} className="text-ink/80">
                      <span className="text-ink/50">{ITEM_FIELD_LABELS[field] ?? field}:</span>{" "}
                      {itemDisplayValue(field, diff.old)} → {itemDisplayValue(field, diff.new)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}

/** "From E-0014 on 15/09/2026 · View receipt", or how it got here otherwise. */
function DescriptionSourceLine({
  source,
  canOpenExpense,
  hasReceipt,
  nameOf,
}: {
  source: DescriptionSource | undefined;
  canOpenExpense: (expenseId: string) => boolean;
  hasReceipt: (expenseId: string) => boolean;
  nameOf: (userId: string | null) => string | null;
}) {
  if (!source) return null;

  if (source.kind === "rename") {
    return (
      <p className="mt-0.5 text-xs text-ink/55">
        Kept from the item&apos;s old name when it was renamed to {source.renamedTo} on {formatDateTime(source.renamedAt)}
      </p>
    );
  }

  if (source.kind === "added") {
    const who = nameOf(source.createdBy);
    return (
      <p className="mt-0.5 text-xs text-ink/55">
        Added {who ? `by ${who} ` : ""}on {formatDateTime(source.createdAt)} — no receipt filed against this item says it
      </p>
    );
  }

  const { latest, expenseCount } = source;
  const label = latest.expenseNumber ?? "an expense";
  const open = canOpenExpense(latest.expenseId);
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink/55">
      <span>
        From{" "}
        {open ? (
          <Link href={`/expenses/${latest.expenseId}`} className="tabular-nums font-medium underline-offset-2 hover:underline hover:text-ink">
            {label}
          </Link>
        ) : (
          <span className="tabular-nums">{label}</span>
        )}
        {latest.date && <> on {formatPlainDate(latest.date.slice(0, 10))}</>}
        {expenseCount > 1 && <> · on {expenseCount} receipts in all</>}
      </span>
      {open && hasReceipt(latest.expenseId) && (
        <>
          <span className="text-ink/30">·</span>
          <ReceiptViewer expenseId={latest.expenseId} label="View receipt" />
        </>
      )}
    </div>
  );
}

function OfferStatus({ status }: { status: string }) {
  if (status === "approved") return null;
  return (
    <span className="ml-2">
      <StatusPill status={status} />
    </span>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink/10 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-ink/40">{label}</p>
      <p className="mt-1 tabular-nums text-base break-words text-ink">{value}</p>
      {note && <p className="text-xs text-ink/50">{note}</p>}
    </div>
  );
}
