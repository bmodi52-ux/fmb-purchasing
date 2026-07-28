import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { updateItem, addPackSize, removePackSize, addOffer, updateOffer, reviewOffer, deleteOffer } from "../actions";
import { OfferForm } from "./offer-form";
import { PackSizeForm } from "./pack-size-form";
import { MergePanel, type DuplicateCandidate } from "./merge-panel";
import { leafCategories, categoryLabelsById } from "@/lib/categories";

const ITEM_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category_id: "Category",
  canonical_unit_id: "Canonical unit",
  comments: "Comments",
};

const OFFER_FIELD_LABELS: Record<string, string> = {
  vendor_id: "Vendor",
  brand: "Brand",
  vendor_sku: "Vendor's product code",
  pack_size_id: "Pack size",
  pack_price: "Pack price",
  comments: "Comments",
  // retained so history written before 0009 still reads sensibly
  unit_price: "Unit price",
  unit_price_unit_id: "Unit price unit",
  per_unit_cost: "Per-unit cost",
  per_unit_cost_unit_id: "Per-unit cost unit",
};

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "pricelist", "edit_master_data");
  const canApprove = can(permissions, "pricelist", "approve_master_data");

  const admin = createAdminClient();
  const [{ data: item }, { data: vendors }, { data: categories }, { data: units }, { data: packSizes }, { data: itemHistory }] =
    await Promise.all([
      admin.from("items").select("*").eq("id", id).maybeSingle(),
      admin.from("vendors").select("id, name, vendor_number").order("name"),
      admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
      admin.from("units").select("id, code, label").order("sort_order"),
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

  const costByOfferId = new Map(
    (offerCosts ?? []).map((c) => [c.offer_id as string, c as { cost_per_base_unit: number | null; base_unit_code: string }])
  );

  // How many submitted purchases hang off each pack size / offer. Drives both
  // the "this will restate N purchases" warning when editing a pack size, and
  // whether an offer can still be deleted.
  const offerIdList = (offers ?? []).map((o) => o.id);
  const { data: usageRows } = offerIdList.length
    ? await admin.from("expense_line_items").select("pricelist_item_id").in("pricelist_item_id", offerIdList)
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

  const { data: duplicateRows } = await admin
    .from("item_duplicate_candidates")
    .select("candidate_id, candidate_name, candidate_item_number, candidate_category_id, score")
    .eq("item_id", id)
    .order("score", { ascending: false })
    .limit(5);

  const offerIds = new Set((offers ?? []).map((o) => o.id));
  const offerHistory = (offerHistoryRows ?? []).filter((h) => offerIds.has(h.item_id));

  const changedByIds = [
    ...new Set([...(itemHistory ?? []).map((h) => h.changed_by), ...offerHistory.map((h) => h.changed_by)].filter(Boolean)),
  ];
  const { data: profiles } =
    changedByIds.length > 0
      ? await admin.from("profiles").select("id, full_name, username").in("id", changedByIds)
      : { data: [] };
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.username]));

  const vendorNameById = new Map((vendors ?? []).map((v) => [v.id, `${v.vendor_number} — ${v.name}`]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

  const assignableCategories = leafCategories(categories ?? []);
  const currentCategory = (categories ?? []).find((c) => c.id === item.category_id);
  const categoryOptions =
    currentCategory && !assignableCategories.some((c) => c.id === currentCategory.id)
      ? [...assignableCategories, currentCategory]
      : assignableCategories;
  /**
   * "1 L × 10 (10 L)" for a carton, "Loose (per kg)" when bought by weight
   * rather than in packs — otherwise a loose item reads as a 1 kg bag.
   */
  function packShape(p: {
    inner_quantity: number;
    inner_unit_id: string;
    pack_count: number;
    total_quantity: number;
    sold_loose?: boolean;
  }) {
    const unit = unitLabelById.get(p.inner_unit_id) ?? "";
    if (p.sold_loose && p.pack_count === 1 && Number(p.inner_quantity) === 1) {
      return `Loose (per ${unit})`.trim();
    }
    return p.pack_count > 1
      ? `${p.inner_quantity} ${unit} × ${p.pack_count} (${p.total_quantity} ${unit})`
      : `${p.inner_quantity} ${unit}`.trim();
  }

  const packSizeLabelById = new Map(
    (packSizes ?? []).map((p) => [p.id, p.label ? `${p.label} — ${packShape(p)}` : packShape(p)])
  );

  function itemDisplayValue(field: string, value: unknown): string {
    if (value == null || value === "") return "—";
    if (field === "category_id") return categoryNameById.get(String(value)) ?? "—";
    if (field === "canonical_unit_id") return unitLabelById.get(String(value)) ?? "—";
    return String(value);
  }

  function offerDisplayValue(field: string, value: unknown): string {
    if (value == null || value === "") return "—";
    if (field === "vendor_id") return vendorNameById.get(String(value)) ?? "—";
    if (field === "pack_size_id") return packSizeLabelById.get(String(value)) ?? "—";
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
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-serif text-3xl font-semibold text-ink">{item.name}</h1>
          <span className="font-mono text-sm text-ink/50">{item.item_number}</span>
        </div>
        <p className="mt-1 text-sm text-ink/50">
          {updatedByName
            ? `Last updated ${formatDateTime(item.updated_at)} by ${updatedByName}`
            : `Created ${formatDateTime(item.created_at)}`}
        </p>
      </div>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 font-serif text-lg font-semibold text-ink">Details</h2>
        <form action={updateItem} className="grid gap-4 sm:grid-cols-2">
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
            <span className="text-ink/70">Canonical unit (for costing)</span>
            <select
              name="canonical_unit_id"
              defaultValue={item.canonical_unit_id}
              disabled={!canEdit}
              required
              className="input"
            >
              {(units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">Comments</span>
            <textarea name="comments" defaultValue={item.comments ?? ""} disabled={!canEdit} rows={2} className="input" />
          </label>
          {canEdit && (
            <button type="submit" className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep sm:col-span-2">
              Save changes
            </button>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 font-serif text-lg font-semibold text-ink">What we&apos;ve actually paid</h2>
        <p className="mb-4 text-sm text-ink/50">
          Derived from submitted receipts rather than quoted pricelist prices — this is the figure that will cost a
          Thaali.
        </p>
        {itemCost ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Most recent"
              value={`$${Number(itemCost.latest_cost_per_base_unit).toFixed(4)}/${itemCost.base_unit_code}`}
              note={itemCost.latest_receipt_date ? `as at ${itemCost.latest_receipt_date}` : null}
            />
            <Stat
              label="Average paid"
              value={`$${Number(itemCost.avg_cost_per_base_unit).toFixed(4)}/${itemCost.base_unit_code}`}
              note={`across ${itemCost.vendor_count} vendor(s)`}
            />
            <Stat label="Purchases" value={String(itemCost.purchase_count)} note="receipt lines" />
            {!itemCost.all_contents_confirmed && (
              <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-ink/80 sm:col-span-3">
                <strong>Provisional.</strong> At least one purchase is against a pack size whose contents haven&apos;t
                been confirmed, so these figures are per <em>pack</em>, not per {itemCost.base_unit_code}. Set what one
                unit contains below and they&apos;ll correct themselves.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink/50">
            No purchases recorded against this item yet — submit an expense and the cost per unit appears here.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 font-serif text-lg font-semibold text-ink">Pack sizes &amp; vendor offers</h2>
        <div className="flex flex-col gap-5">
          {(packSizes ?? []).map((p) => {
            const packOffers = offersByPackSize.get(p.id) ?? [];
            const packUnitLabel = unitLabelById.get(p.inner_unit_id) ?? null;
            return (
              <div key={p.id} className="rounded-md border border-ink/10 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">
                    {p.label && <span>{p.label} — </span>}
                    <span className="font-mono">{packShape(p)}</span>
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
                      <button type="submit" className="text-xs text-maroon/70 hover:underline">
                        remove
                      </button>
                    </form>
                  )}
                </div>

                {canEdit && (
                  <details className="mb-3" open={!p.contents_confirmed}>
                    <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">
                      {p.contents_confirmed ? "Edit pack size" : "Confirm what one unit contains"}
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
                        units={units ?? []}
                        purchaseCount={purchasesByPackSize.get(p.id) ?? 0}
                      />
                    </div>
                  </details>
                )}

                <ul className="flex flex-col gap-3">
                  {packOffers.map((o) => {
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
                            {o.vendor_sku && <span className="ml-1 font-mono text-xs text-ink/40">#{o.vendor_sku}</span>}
                            <StatusBadge status={o.status} />
                          </div>
                          <span className="font-mono text-ink/70">
                            {o.pack_price != null ? `$${o.pack_price}` : "—"}
                            {cost?.cost_per_base_unit != null && (
                              <span className="ml-2 text-ink/50">
                                (${cost.cost_per_base_unit.toFixed(4)}/{cost.base_unit_code})
                              </span>
                            )}
                          </span>
                        </div>
                        {o.comments && <p className="mt-1 text-ink/60">{o.comments}</p>}

                        {canApprove && o.status === "pending" && (
                          <div className="mt-2 flex gap-3">
                            <form action={reviewOffer}>
                              <input type="hidden" name="offer_id" value={o.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <button type="submit" className="text-xs text-palm hover:underline">
                                Approve
                              </button>
                            </form>
                            <form action={reviewOffer}>
                              <input type="hidden" name="offer_id" value={o.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <button type="submit" className="text-xs text-maroon/70 hover:underline">
                                Reject
                              </button>
                            </form>
                          </div>
                        )}

                        <div className="mt-2 flex gap-4 text-xs text-ink/50">
                          {canEdit && (
                            <details>
                              <summary className="cursor-pointer hover:text-ink">Edit</summary>
                              <div className="mt-2">
                                <OfferForm
                                  action={updateOffer}
                                  itemId={item.id}
                                  packSizeId={p.id}
                                  offerId={o.id}
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
                              <button type="submit" className="text-xs text-maroon/70 hover:underline">
                                Delete offer
                              </button>
                            </form>
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
                  })}
                  {packOffers.length === 0 && <li className="text-sm text-ink/50">No vendor offers yet.</li>}
                </ul>

                {canEdit && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">+ Add vendor offer</summary>
                    <div className="mt-2">
                      <OfferForm
                        action={addOffer}
                        itemId={item.id}
                        packSizeId={p.id}
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
          <form action={addPackSize} className="mt-5 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
            <input type="hidden" name="item_id" value={item.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Each holds</span>
              <input name="inner_quantity" type="number" step="any" defaultValue={1} required className="input w-24" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Unit</span>
              <select name="inner_unit_id" defaultValue={item.canonical_unit_id} required className="input w-28">
                {(units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">How many per pack</span>
              <input name="pack_count" type="number" step="1" min={1} defaultValue={1} required className="input w-28" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Label (optional)</span>
              <input name="label" placeholder="e.g. 1L x 10 carton" className="input" />
            </label>
            <button type="submit" className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
              + Add pack size
            </button>
          </form>
        )}
      </section>

      {canEdit && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-1 font-serif text-lg font-semibold text-ink">Duplicates</h2>
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

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 font-serif text-lg font-semibold text-ink">Item change history</h2>
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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return null;
  const color = status === "rejected" ? "text-maroon/70" : "text-gold-deep";
  return <span className={`ml-2 text-xs ${color}`}>{status}</span>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-md border border-ink/10 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-ink/40">{label}</p>
      <p className="mt-1 font-mono text-base break-words text-ink">{value}</p>
      {note && <p className="text-xs text-ink/50">{note}</p>}
    </div>
  );
}
