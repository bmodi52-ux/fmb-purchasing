import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { AddItemModal } from "./add-item-modal";
import { UnitsManager } from "./units-manager";
import { ItemsTable, type OfferRow } from "./items-table";
import { leafCategories, categoryLabelsById } from "@/lib/categories";

const PAGE_KEY = "pricelist";
const DEFAULT_VISIBLE = [
  "item_number",
  "name",
  "vendor",
  "category",
  "pack_size",
  "pack_price",
  "cost_per_unit",
  "status",
  "actions",
];

type OfferQueryRow = {
  id: string;
  status: string;
  vendor_id: string | null;
  brand: string | null;
  vendor_sku: string | null;
  comments: string | null;
  pack_size_id: string;
  item_pack_sizes: {
    id: string;
    inner_quantity: number;
    inner_unit_id: string;
    pack_count: number;
    total_quantity: number;
    label: string | null;
    item_id: string;
    items: {
      id: string;
      item_number: string | null;
      name: string;
      category_id: string | null;
      status: string;
    } | null;
  } | null;
};

/** Cost per base unit is derived by the offer_unit_costs view, never stored. */
type OfferCostRow = {
  offer_id: string;
  pack_price: number | null;
  cost_per_base_unit: number | null;
  base_unit_code: string;
};

export default async function PricelistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "pricelist", "edit_master_data");
  const canApprove = can(permissions, "pricelist", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: offers }, { data: offerCosts }, { data: vendors }, { data: categories }, { data: units }, visibleColumns] =
    await Promise.all([
      admin
        .from("pricelist_items")
        .select(
          "id, status, vendor_id, brand, vendor_sku, comments, pack_size_id, item_pack_sizes ( id, inner_quantity, inner_unit_id, pack_count, total_quantity, label, item_id, items ( id, item_number, name, category_id, status ) )"
        )
        .returns<OfferQueryRow[]>(),
      admin
        .from("offer_unit_costs")
        .select("offer_id, pack_price, cost_per_base_unit, base_unit_code")
        .returns<OfferCostRow[]>(),
      admin.from("vendors").select("id, name, vendor_number").order("name"),
      admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
      admin.from("units").select("id, code, label").order("sort_order"),
      getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
    ]);

  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));
  const costByOfferId = new Map((offerCosts ?? []).map((c) => [c.offer_id, c]));
  const assignableCategories = leafCategories(categories ?? []).map((c) => ({
    id: c.id,
    name: categoryNameById.get(c.id) ?? c.name,
  }));

  const rows: OfferRow[] = (offers ?? [])
    .filter((o) => o.item_pack_sizes?.items)
    .map((o) => {
      const packSize = o.item_pack_sizes!;
      const item = packSize.items!;
      const cost = costByOfferId.get(o.id);
      return {
        id: o.id,
        itemId: item.id,
        itemNumber: item.item_number,
        name: item.name,
        status: o.status,
        vendorLabel: o.vendor_id ? (vendorById.get(o.vendor_id)?.name ?? "—") : "— no vendor —",
        categoryLabel: item.category_id ? (categoryNameById.get(item.category_id) ?? "—") : "—",
        brand: o.brand,
        vendorSku: o.vendor_sku,
        innerQuantity: packSize.inner_quantity,
        innerUnitLabel: unitLabelById.get(packSize.inner_unit_id) ?? null,
        packCount: packSize.pack_count,
        totalQuantity: packSize.total_quantity,
        packLabel: packSize.label,
        packPrice: cost?.pack_price ?? null,
        costPerBaseUnit: cost?.cost_per_base_unit ?? null,
        baseUnitCode: cost?.base_unit_code ?? null,
        comments: o.comments,
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));

  const pending = rows.filter((r) => r.status === "pending");
  const rest = rows.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink">Pricelist</h1>
          <p className="mt-1 max-w-xl text-ink/70">
            Each item can have several pack sizes, and each pack size several
            vendor offers. Click an item for the full breakdown, its pack
            sizes and offers, and change history.
          </p>
        </div>
        {canEdit && (
          <AddItemModal
            vendors={vendors ?? []}
            categories={assignableCategories}
            units={units ?? []}
          />
        )}
      </div>

      {canEdit && <UnitsManager units={units ?? []} />}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg font-semibold text-ink">Pending review ({pending.length})</h2>
          <ItemsTable rows={pending} allOffers={rows} canApprove={canApprove} initialVisible={visibleColumns} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-serif text-lg font-semibold text-ink">All offers</h2>
        <ItemsTable rows={rest} allOffers={rows} canApprove={canApprove} initialVisible={visibleColumns} emptyLabel="None." />
      </section>
    </div>
  );
}
