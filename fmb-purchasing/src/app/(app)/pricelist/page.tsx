import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { AddItemModal } from "./add-item-modal";
import { UnitsManager } from "./units-manager";
import { ItemsTable, type OfferRow } from "./items-table";

const PAGE_KEY = "pricelist";
const DEFAULT_VISIBLE = [
  "item_number",
  "name",
  "vendor",
  "category",
  "pack_size",
  "unit_price",
  "per_unit_cost",
  "status",
  "actions",
];

type OfferQueryRow = {
  id: string;
  status: string;
  vendor_id: string | null;
  brand: string | null;
  unit_price: number | null;
  unit_price_unit_id: string | null;
  per_unit_cost: number | null;
  per_unit_cost_unit_id: string | null;
  comments: string | null;
  pack_size_id: string;
  item_pack_sizes: {
    id: string;
    pack_size: number;
    pack_size_unit_id: string;
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

export default async function PricelistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "pricelist", "edit_master_data");
  const canApprove = can(permissions, "pricelist", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: offers }, { data: vendors }, { data: categories }, { data: units }, visibleColumns] =
    await Promise.all([
      admin
        .from("pricelist_items")
        .select(
          "id, status, vendor_id, brand, unit_price, unit_price_unit_id, per_unit_cost, per_unit_cost_unit_id, comments, pack_size_id, item_pack_sizes ( id, pack_size, pack_size_unit_id, label, item_id, items ( id, item_number, name, category_id, status ) )"
        )
        .returns<OfferQueryRow[]>(),
      admin.from("vendors").select("id, name, vendor_number").order("name"),
      admin.from("categories").select("id, name").order("sort_order"),
      admin.from("units").select("id, code, label").order("sort_order"),
      getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
    ]);

  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

  const rows: OfferRow[] = (offers ?? [])
    .filter((o) => o.item_pack_sizes?.items)
    .map((o) => {
      const packSize = o.item_pack_sizes!;
      const item = packSize.items!;
      return {
        id: o.id,
        itemId: item.id,
        itemNumber: item.item_number,
        name: item.name,
        status: o.status,
        vendorLabel: o.vendor_id ? (vendorById.get(o.vendor_id)?.name ?? "—") : "— no vendor —",
        categoryLabel: item.category_id ? (categoryNameById.get(item.category_id) ?? "—") : "—",
        brand: o.brand,
        packSize: packSize.pack_size,
        packSizeUnitLabel: unitLabelById.get(packSize.pack_size_unit_id) ?? null,
        packLabel: packSize.label,
        unit_price: o.unit_price,
        per_unit_cost: o.per_unit_cost,
        perUnitCostUnitLabel: o.per_unit_cost_unit_id ? (unitLabelById.get(o.per_unit_cost_unit_id) ?? null) : null,
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
            categories={categories ?? []}
            units={units ?? []}
          />
        )}
      </div>

      {canEdit && <UnitsManager units={units ?? []} />}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 font-serif text-lg font-semibold text-ink">Pending review ({pending.length})</h2>
          <ItemsTable rows={pending} canApprove={canApprove} initialVisible={visibleColumns} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-serif text-lg font-semibold text-ink">All offers</h2>
        <ItemsTable rows={rest} canApprove={canApprove} initialVisible={visibleColumns} emptyLabel="None." />
      </section>
    </div>
  );
}
