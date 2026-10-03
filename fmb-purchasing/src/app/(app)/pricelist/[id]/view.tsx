import { SubmitButton } from "@/components/submit-button";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { updateItem, reviewItem, addVendorItemDescription, removeVendorItemDescription } from "../actions";
import { ReviewDecision, StatusPill } from "@/components/review-decision";
import { OffersTable, type OfferRow, type OfferSource } from "./offers-table";
import { PackSizesTable, type PackRow } from "./pack-sizes-table";
import {
  formatPackPrice,
  formatUnitCost,
  packTitle,
  priceFieldLabel,
  unitName,
  unitOptionLabel,
} from "@/lib/pack-description";
import { summarisePackPrices } from "@/lib/pack-prices";
import { summariseOfferPurchases } from "@/lib/item-offers";
import { MergePanel, type DuplicateCandidate } from "./merge-panel";
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
  preferred_brand: "Preferred brand",
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
  store_product_name: "Store's name for it",
  pack_size_id: "Pack size",
  pack_price: "Pack price",
  price_source: "Price from",
  status: "Status",
  comments: "Comments",
  // retained so history written before 0009 still reads sensibly
  unit_price: "Unit price",
  unit_price_unit_id: "Unit price unit",
  per_unit_cost: "Per-unit cost",
  per_unit_cost_unit_id: "Per-unit cost unit",
};

/** The date a price was set, or null for none (or a provisional "-infinity"). */
function priceDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Offer history keys starting "_" are bookkeeping for undoing, not changes to show. */
function shownChanges(changes: unknown): [string, { old: unknown; new: unknown }][] {
  return Object.entries(changes as Record<string, { old: unknown; new: unknown }>).filter(([k]) => !k.startsWith("_"));
}

export type ItemTab = "overview" | "purchases" | "settings" | "history";

/**
 * One item, in three tabs (#53): Overview is what people come for day to day —
 * what it costs and who sells it — Settings is the setup that is changed
 * rarely, and History is the record of changes.
 *
 * Seven sections on one page read as cluttered, and the Details form sat on
 * top of everything although it is the part least often touched. Each tab is
 * its own address (?tab=settings), as on a vendor's page, so a link can open
 * the right one.
 *
 * The page signs the viewer in and checks they may see the Pricelist; this is
 * everything after that.
 */
export async function ItemDetailView({
  user,
  id,
  tab,
}: {
  user: CurrentUser;
  id: string;
  tab: ItemTab;
}) {
  const permissions = await getUserPermissions(user);
  const canEdit = can(permissions, "pricelist", "edit_master_data");
  const canApprove = can(permissions, "pricelist", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: item }, { data: vendors }, { data: categories }, { data: units }, { data: packSizes }, { data: itemHistory }] =
    await Promise.all([
      admin.from("items").select("*").eq("id", id).maybeSingle(),
      admin.from("vendors").select("id, name, vendor_number").is("merged_into", null).order("name"),
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
    // This item's offers' history only, not the whole table, which outgrows
    // the 1,000 rows one request returns.
    packSizeIds.length
      ? admin
          .from("pricelist_item_history")
          .select("id, item_id, changed_at, changed_by, changes, pricelist_items!inner ( pack_size_id )")
          .in("pricelist_items.pack_size_id", packSizeIds)
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
    ? await admin
        .from("expense_line_items")
        .select("id, pricelist_item_id, expense_id, expenses!inner(expense_number, receipt_date, created_at, submitted_by)")
        .in("pricelist_item_id", offerIdList)
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
  const offerByLineId = new Map((usageRows ?? []).map((r) => [r.id as string, r.pricelist_item_id as string]));
  const offerPurchases = summariseOfferPurchases(
    (paidRows ?? []).flatMap((r) => {
      const offerId = offerByLineId.get(r.line_item_id as string);
      return offerId
        ? [
            {
              offerId,
              lineTotal: Number(r.line_total),
              quantity: Number(r.normalized_quantity),
              receiptDate: (r.receipt_date as string | null) ?? null,
              submittedAt: r.submitted_at as string,
            },
          ]
        : [];
    })
  );
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
  // A receipt that confirmed the price it found writes only its undo (#57),
  // which is nothing to show.
  const offerHistory = (offerHistoryRows ?? []).filter(
    (h) => offerIds.has(h.item_id) && shownChanges(h.changes).length > 0
  );

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

  // The receipt behind each offer (#58): the line its price was taken from
  // (#46), or failing that the first line ever filed against it.
  type OfferLine = { id: string; expenseId: string; expenseNumber: string | null; date: string; submittedBy: string };
  const linesByOffer = new Map<string, OfferLine[]>();
  for (const r of usageRows ?? []) {
    const expense = (Array.isArray(r.expenses) ? r.expenses[0] : r.expenses) as {
      expense_number: string | null;
      receipt_date: string | null;
      created_at: string | null;
      submitted_by: string;
    };
    const key = r.pricelist_item_id as string;
    linesByOffer.set(key, [
      ...(linesByOffer.get(key) ?? []),
      {
        id: r.id as string,
        expenseId: r.expense_id as string,
        expenseNumber: expense.expense_number,
        date: expense.receipt_date ?? expense.created_at ?? "",
        submittedBy: expense.submitted_by,
      },
    ]);
  }
  const sourceLineByOffer = new Map<string, OfferLine>();
  for (const o of offers ?? []) {
    const lines = linesByOffer.get(o.id) ?? [];
    const source =
      lines.find((l) => l.id === o.price_source_line_id) ?? [...lines].sort((a, b) => a.date.localeCompare(b.date))[0];
    if (source) sourceLineByOffer.set(o.id, source);
  }
  const canOpenLine = (line: OfferLine) => seesAllExpenses || line.submittedBy === user.id;
  const offerSourceExpenseIds = [
    ...new Set([...sourceLineByOffer.values()].filter(canOpenLine).map((l) => l.expenseId)),
  ];
  const { data: offerSourceAttachments } =
    tab === "overview" && offerSourceExpenseIds.length
      ? await admin.from("expense_attachments").select("expense_id").in("expense_id", offerSourceExpenseIds)
      : { data: [] };
  const offerSourcesWithReceipt = new Set((offerSourceAttachments ?? []).map((a) => a.expense_id as string));

  const vendorById = new Map((vendors ?? []).map((v) => [v.id as string, v]));
  const packSizeById = new Map((packSizes ?? []).map((p) => [p.id as string, p]));
  const today = todayIso();

  const offerRows: OfferRow[] = (offers ?? []).map((o) => {
    const cost = costByOfferId.get(o.id);
    const paid = offerPurchases.get(o.id);
    const vendor = o.vendor_id ? vendorById.get(o.vendor_id) : undefined;
    const line = sourceLineByOffer.get(o.id);
    const source: OfferSource | null = line
      ? {
          expenseId: line.expenseId,
          expenseNumber: line.expenseNumber,
          canOpen: canOpenLine(line),
          hasReceipt: offerSourcesWithReceipt.has(line.expenseId),
        }
      : null;
    return {
      id: o.id,
      status: o.status,
      vendorId: o.vendor_id ?? null,
      vendorName: vendor?.name ?? null,
      vendorNumber: vendor?.vendor_number ?? null,
      brand: o.brand ?? null,
      vendorSku: o.vendor_sku ?? null,
      storeProductName: o.store_product_name ?? null,
      comments: o.comments ?? null,
      packSizeId: o.pack_size_id,
      packQuantity: Number(packSizeById.get(o.pack_size_id)?.total_quantity ?? 0),
      packPrice: o.pack_price != null ? Number(o.pack_price) : null,
      costPerUnit: cost?.cost_per_base_unit != null ? Number(cost.cost_per_base_unit) : null,
      baseUnitCode: cost?.base_unit_code ?? null,
      priceSetOn: priceDay(o.price_set_at),
      source,
      special:
        o.sale_price != null && o.sale_ends_on && String(o.sale_ends_on) >= today
          ? { price: Number(o.sale_price), endsOn: String(o.sale_ends_on), assumed: Boolean(o.sale_end_assumed) }
          : null,
      gstAdded: o.gst_basis === "added",
      sourceUrl: o.source_url ? String(o.source_url) : null,
      lastPaid: paid?.lastPaid ?? null,
      lastPaidOn: paid?.lastPaidOn ?? null,
      purchaseCount: paid?.purchaseCount ?? 0,
      lineCount: purchasesByOffer.get(o.id) ?? 0,
      history: (historyByOffer.get(o.id) ?? []).map((h) => ({
        id: h.id as string,
        when: formatDateTime(h.changed_at),
        by: h.changed_by ? (profileNameById.get(h.changed_by) ?? "unknown") : null,
        changes: shownChanges(h.changes).map(([field, diff]) => ({
          label: OFFER_FIELD_LABELS[field] ?? field,
          from: offerDisplayValue(field, diff.old),
          to: offerDisplayValue(field, diff.new),
        })),
      })),
    };
  });

  const packRows: PackRow[] = (packSizes ?? []).map((p) => {
    const prices = packPrices.get(p.id);
    const shape = packShapeOf(p);
    const packOffers = offersByPackSize.get(p.id) ?? [];
    return {
      id: p.id,
      title: packSizeLabelById.get(p.id) ?? "",
      contentsConfirmed: Boolean(p.contents_confirmed),
      lastPaid: prices ? formatPackPrice(prices.latest, shape) : null,
      averagePaid: prices ? formatPackPrice(prices.average, shape) : null,
      purchaseCount: prices?.purchaseCount ?? 0,
      offerCount: packOffers.filter((o) => o.status !== "rejected").length,
      hasOffers: packOffers.length > 0,
      lineCount: purchasesByPackSize.get(p.id) ?? 0,
      innerQuantity: p.inner_quantity,
      innerUnitId: p.inner_unit_id,
      packCount: p.pack_count,
      label: p.label,
      soldLoose: p.sold_loose,
      packaging: p.packaging,
    };
  });

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
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">
              Preferred brand <span className="text-ink/40">(optional)</span>
            </span>
            <input
              name="preferred_brand"
              list="item-brands"
              defaultValue={(item.preferred_brand as string | null) ?? ""}
              disabled={!canEdit}
              placeholder="Any brand"
              className="input"
            />
            <datalist id="item-brands">
              {[...new Set((offers ?? []).map((o) => o.brand as string | null).filter((b): b is string => !!b))].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <span className="text-xs text-ink/45">
              Left empty, the cheapest of any brand is used. Set, costing and the buying list use only this brand, at
              whichever store is cheapest.
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
              note={itemCost.latest_receipt_date ? `as at ${formatPlainDate(String(itemCost.latest_receipt_date))}` : null}
            />
            <Stat
              label={`Average paid, per ${unitName(itemCost.base_unit_code)}`}
              value={formatUnitCost(Number(itemCost.avg_cost_per_base_unit), itemCost.base_unit_code)}
              note={`across ${itemCost.vendor_count} ${itemCost.vendor_count === 1 ? "vendor" : "vendors"}`}
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

      <OffersTable
        itemId={item.id}
        offers={offerRows}
        packs={(packSizes ?? []).map((p) => ({
          id: p.id,
          title: packSizeLabelById.get(p.id) ?? "",
          priceLabel: priceFieldLabel(packShapeOf(p)),
          totalQuantity: Number(p.total_quantity),
          unitLabel: unitLabelById.get(p.inner_unit_id) ?? null,
        }))}
        vendors={vendors ?? []}
        unitCode={
          itemCost?.base_unit_code ??
          ((units ?? []).find((u) => u.id === item.canonical_unit_id)?.base_unit_code as string | undefined) ??
          null
        }
        canEdit={canEdit}
        canApprove={canApprove}
      />

      <PackSizesTable
        itemId={item.id}
        canonicalUnitId={item.canonical_unit_id}
        packs={packRows}
        units={units ?? []}
        canEdit={canEdit}
      />
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
                    <SubmitButton className="shrink-0 text-xs text-danger/70 hover:underline">remove</SubmitButton>
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

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink/10 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-ink/40">{label}</p>
      <p className="mt-1 tabular-nums text-base break-words text-ink">{value}</p>
      {note && <p className="text-xs text-ink/50">{note}</p>}
    </div>
  );
}
