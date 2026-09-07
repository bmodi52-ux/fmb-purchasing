import { SubmitButton } from "@/components/submit-button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { AddItemModal } from "./add-item-modal";
import { ItemsTable, type OfferRow } from "./items-table";
import { dismissDuplicatePair } from "./actions";
import { withoutRejectedOffers } from "./collapse-offers";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";

export const metadata = { title: "Pricelist" };

const PAGE_KEY = "pricelist";
// Vendor is deliberately off by default. A row is a vendor offer, so showing
// that column is what splits an item into one row per vendor; with it hidden
// the table collapses to one row per item (see collapseToItems in
// items-table.tsx). Defaulting it on would mean every multi-vendor item
// appeared several times before anyone had asked to compare vendors.
const DEFAULT_VISIBLE = [
  "item_number",
  "name",
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
    sold_loose: boolean;
    contents_confirmed: boolean;
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
          "id, status, vendor_id, brand, vendor_sku, comments, pack_size_id, item_pack_sizes ( id, inner_quantity, inner_unit_id, pack_count, total_quantity, label, sold_loose, contents_confirmed, item_id, items ( id, item_number, name, category_id, status ) )"
        )
        .returns<OfferQueryRow[]>(),
      admin
        .from("offer_unit_costs")
        .select("offer_id, pack_price, cost_per_base_unit, base_unit_code")
        .returns<OfferCostRow[]>(),
      admin.from("vendors").select("id, name, vendor_number").order("name"),
      admin.from("categories").select("id, name, parent_category_id, code").order("sort_order"),
      admin.from("units").select("id, code, label").order("sort_order"),
      getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
    ]);

  // Receipt-created items arrive uncategorised whenever extraction could not
  // classify the line, and an uncategorised item is invisible in the numbering
  // (it reads I-0042, not CHK-0042) and lands in "Uncategorised" on every
  // report. Surfaced here so the fix is a click away rather than something
  // nobody discovers.
  const { data: uncategorisedItems } = canEdit
    ? await admin.from("items").select("id, item_number, name").is("category_id", null).order("name")
    : { data: null };

  const { data: duplicateRows } = await admin
    .from("item_duplicate_candidates")
    .select("item_id, item_name, item_number, candidate_id, candidate_name, candidate_item_number, score")
    .order("score", { ascending: false })
    .limit(50);

  // The view reports each pair from both sides; keep one row per pair.
  const seenPairs = new Set<string>();
  const duplicatePairs = (duplicateRows ?? []).filter((d) => {
    const key = [d.item_id, d.candidate_id].sort().join("|");
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));
  const costByOfferId = new Map((offerCosts ?? []).map((c) => [c.offer_id, c]));
  const assignableCategories = leafCategories(sortCategories(categories ?? [])).map((c) => ({
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
        soldLoose: packSize.sold_loose,
        contentsConfirmed: packSize.contents_confirmed,
        packPrice: cost?.pack_price ?? null,
        costPerBaseUnit: cost?.cost_per_base_unit ?? null,
        baseUnitCode: cost?.base_unit_code ?? null,
        comments: o.comments,
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));

  // Rejections belong to the item page, not to the list everyone reads to see
  // what things cost — see withoutRejectedOffers.
  const live = withoutRejectedOffers(rows);
  const pending = live.filter((r) => r.status === "pending");
  const rest = live.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      {/* Stacked on phones: side by side, the action button gets squeezed to
          roughly its own width and wraps mid-label. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="page-title text-ink">Pricelist</h1>
          <p className="page-description mt-1 max-w-xl">
            Each item can have several pack sizes, and each pack size several
            vendor offers. Click an item for the full breakdown, its pack
            sizes and offers, and change history.
          </p>
          {/* The reference lists behind the pricelist. Their own pages rather
              than disclosures here: Categories has grown into real master data
              since 0024 made its code the prefix on every item number, and
              nineteen rows of it pushed the offers table off the screen. */}
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/pricelist/categories"
                className="rounded-md border border-ink/15 bg-white/60 px-3 py-1.5 text-sm text-ink/80 transition-colors hover:border-ink/30 hover:text-ink"
              >
                Manage categories
              </Link>
              <Link
                href="/pricelist/units"
                className="rounded-md border border-ink/15 bg-white/60 px-3 py-1.5 text-sm text-ink/80 transition-colors hover:border-ink/30 hover:text-ink"
              >
                Manage units
              </Link>
            </div>
          )}
        </div>
        {canEdit && (
          <AddItemModal
            vendors={vendors ?? []}
            categories={assignableCategories}
            units={units ?? []}
          />
        )}
      </div>

      {canEdit && (uncategorisedItems ?? []).length > 0 && (
        <details className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {uncategorisedItems!.length} item{uncategorisedItems!.length === 1 ? "" : "s"} without a category
          </summary>
          <p className="mt-2 text-sm text-ink/60">
            Receipt extraction files a line as uncategorised when the wording
            doesn&rsquo;t say what it is. Until someone chooses, these number as
            I-0000 rather than by category, and report as Uncategorised.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {uncategorisedItems!.map((i) => (
              <li key={i.id as string}>
                <Link href={`/pricelist/${i.id}`} className="text-ink underline">
                  <span className="font-mono text-xs text-ink/50">{(i.item_number as string) ?? "—"}</span>{" "}
                  {i.name as string}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && duplicatePairs.length > 0 && (
        <details className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {duplicatePairs.length} possible duplicate item{duplicatePairs.length === 1 ? "" : "s"} — worth a look
          </summary>
          <p className="mt-2 text-sm text-ink/60">
            Similar names usually mean the same product got recorded twice, which splits its price history. Open either
            item to merge them.
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {duplicatePairs.map((d) => (
              <li key={`${d.item_id}-${d.candidate_id}`} className="flex flex-wrap items-center gap-2">
                <Link href={`/pricelist/${d.item_id}`} className="text-ink underline">
                  {d.item_number ? `${d.item_number} — ` : ""}
                  {d.item_name as string}
                </Link>
                <span className="text-ink/40">vs</span>
                <Link href={`/pricelist/${d.candidate_id}`} className="text-ink underline">
                  {d.candidate_item_number ? `${d.candidate_item_number} — ` : ""}
                  {d.candidate_name as string}
                </Link>
                <span className="text-xs text-ink/40">{Math.round(Number(d.score) * 100)}% similar</span>
                <form action={dismissDuplicatePair}>
                  <input type="hidden" name="item_a" value={d.item_id as string} />
                  <input type="hidden" name="item_b" value={d.candidate_id as string} />
                  <SubmitButton className="text-xs text-ink/50 hover:text-ink hover:underline">
                    not a duplicate
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 section-title text-ink">Pending review ({pending.length})</h2>
          <ItemsTable rows={pending} allOffers={live} canApprove={canApprove} initialVisible={visibleColumns} />
        </section>
      )}

      <section>
        <h2 className="section-title text-ink">Items</h2>
        {/* Phrased to hold either way round, since this is server-rendered and
            column visibility lives in the client table. */}
        <p className="mb-2 text-sm text-ink/50">
          Each vendor&rsquo;s offer is listed as its own row only while the Vendor
          column is shown. Otherwise expand an item to compare its vendors.
        </p>
        <ItemsTable rows={rest} allOffers={live} canApprove={canApprove} initialVisible={visibleColumns} emptyLabel="None." collapseByItem />
      </section>
    </div>
  );
}
