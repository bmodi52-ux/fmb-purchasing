"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { reviewOffer, updateOfferPrice } from "../../pricelist/actions";

export type VendorProductRow = {
  offerId: string;
  status: string;
  itemId: string;
  itemName: string;
  itemNumber: string | null;
  categoryName: string | null;
  packTitle: string;
  /** "$40.00 per box", or null when no price has been entered. */
  price: string | null;
  packPrice: number | null;
  /** "Price per box" — what an entered price is for. */
  priceLabel: string;
  /** "$6.6667/kg", or null when it cannot be worked out. */
  perUnit: string | null;
  brand: string | null;
  vendorSku: string | null;
  purchaseCount: number;
  lastBought: string | null;
  /** What one pack cost on the most recent receipt from this vendor. */
  lastPaid: { price: number; text: string } | null;
};

type Filter = "all" | "needs-price" | "pending";

/**
 * What a vendor supplies, on its Products tab.
 *
 * Grouped the way someone reads a supplier: by category, then by item, with
 * each pack size underneath — rather than the item name repeated once per
 * pack. A price can be set or corrected where it is read. What still needs
 * doing is one tap away: products with no price, and offers waiting for a
 * reviewer. And what was actually paid sits beside the price on file, flagged
 * when the two have drifted apart.
 */
export function VendorProducts({
  vendorId,
  vendorName,
  rows,
  canViewPricelist,
  canApprove,
  canEdit,
  actions,
}: {
  vendorId: string;
  vendorName: string;
  rows: VendorProductRow[];
  canViewPricelist: boolean;
  canApprove: boolean;
  canEdit: boolean;
  /** Adding products, for whoever may. */
  actions: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);

  const live = rows.filter((r) => r.status !== "rejected");
  const rejected = rows.filter((r) => r.status === "rejected");
  const needsPrice = live.filter((r) => r.packPrice == null).length;
  const pending = live.filter((r) => r.status === "pending").length;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = live
      .filter((r) => (filter === "needs-price" ? r.packPrice == null : filter === "pending" ? r.status === "pending" : true))
      .filter(
        (r) =>
          !q ||
          [r.itemName, r.itemNumber, r.brand, r.packTitle, r.categoryName, r.vendorSku]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
      );

    const byCategory = new Map<string, Map<string, VendorProductRow[]>>();
    for (const r of shown) {
      const category = r.categoryName ?? "Uncategorised";
      const items = byCategory.get(category) ?? new Map<string, VendorProductRow[]>();
      items.set(r.itemId, [...(items.get(r.itemId) ?? []), r]);
      byCategory.set(category, items);
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => (a === "Uncategorised" ? 1 : b === "Uncategorised" ? -1 : a.localeCompare(b)))
      .map(([category, items]) => ({
        category,
        items: [...items.values()]
          .map((packs) => packs.sort((a, b) => a.packTitle.localeCompare(b.packTitle)))
          .sort((a, b) => a[0]!.itemName.localeCompare(b[0]!.itemName)),
      }));
    // live is derived from rows on every render; rows is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filter]);

  const chips: { key: Filter; label: string; count: number; attention?: boolean }[] = [
    { key: "all", label: "All", count: live.length },
    { key: "needs-price", label: "Needs a price", count: needsPrice, attention: needsPrice > 0 },
    { key: "pending", label: "Waiting for review", count: pending },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-xl text-sm text-ink/55">
          Everything {vendorName} supplies: each item with its pack sizes, the price on file, and what was last paid.
        </p>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {live.length === 0 ? (
        <p className="rounded-lg border border-ink/10 bg-white/60 p-5 text-sm text-ink/50">
          No products recorded for {vendorName} yet.{" "}
          {actions
            ? "Add one, or photograph a price tag or their price list."
            : "They appear once a receipt from this vendor has been submitted."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${vendorName}'s products`}
              aria-label="Search products"
              className="input w-full sm:w-72"
            />
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:pb-0">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilter(c.key)}
                  aria-pressed={filter === c.key}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    filter === c.key
                      ? "bg-ink text-cream"
                      : c.attention
                        ? "bg-gold/20 text-gold-deep hover:bg-gold/30"
                        : "bg-ink/5 text-ink/70 hover:bg-ink/10"
                  }`}
                >
                  {c.label}
                  <span className="ml-1.5 text-xs opacity-75">{c.count}</span>
                </button>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-ink/50">Nothing matches.</p>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium tracking-wide text-ink/45 uppercase">
                  {group.category} <span className="font-normal normal-case">· {group.items.length}</span>
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.items.map((packs) => {
                    const first = packs[0]!;
                    return (
                      <li key={first.itemId} className="rounded-lg border border-ink/10 bg-white/60">
                        <div className="flex flex-wrap items-baseline gap-x-2 border-b border-ink/5 px-3 py-2">
                          {canViewPricelist ? (
                            <Link href={`/pricelist/${first.itemId}`} className="font-medium text-ink hover:underline">
                              {first.itemName}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink">{first.itemName}</span>
                          )}
                          {first.itemNumber && <span className="font-mono text-xs text-ink/45">{first.itemNumber}</span>}
                        </div>
                        <ul className="divide-y divide-ink/5">
                          {packs.map((r) => (
                            <PackLine
                              key={r.offerId}
                              row={r}
                              vendorId={vendorId}
                              canEdit={canEdit}
                              canApprove={canApprove}
                              editing={editing === r.offerId}
                              onEdit={() => setEditing(r.offerId)}
                              onDoneEditing={() => setEditing(null)}
                            />
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </>
      )}

      {/* Kept rather than hidden for good: a rejected offer is a price somebody
          decided against, and the purchases filed against it still point at it. */}
      {rejected.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">{rejected.length} rejected</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/60">
            {rejected.map((r) => (
              <li key={r.offerId}>
                {r.itemName} · {r.packTitle}
                {r.price ? ` · ${r.price}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PackLine({
  row: r,
  vendorId,
  canEdit,
  canApprove,
  editing,
  onEdit,
  onDoneEditing,
}: {
  row: VendorProductRow;
  vendorId: string;
  canEdit: boolean;
  canApprove: boolean;
  editing: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
}) {
  // How far the last price paid is from the price on file. A percent either
  // way is noise; beyond it, somebody should know the list has drifted.
  const drift =
    r.lastPaid && r.packPrice ? (r.lastPaid.price - r.packPrice) / r.packPrice : null;
  const drifted = drift != null && Math.abs(drift) >= 0.01;

  const facts = [
    r.purchaseCount > 0
      ? `Bought ${r.purchaseCount} time${r.purchaseCount === 1 ? "" : "s"}${r.lastBought ? `, last ${r.lastBought}` : ""}`
      : "Not bought yet",
    [r.brand, r.vendorSku ? `#${r.vendorSku}` : null].filter(Boolean).join(" · ") || null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm text-ink/85">{r.packTitle}</p>
        <p className="text-xs text-ink/50">{facts.join(" · ")}</p>
        {r.lastPaid && (
          <p className="text-xs text-ink/55">
            Last paid {r.lastPaid.text}
            {drifted && (
              <span className={`ml-1.5 font-medium ${drift! > 0 ? "text-maroon" : "text-palm"}`}>
                {drift! > 0 ? "▲" : "▼"} {Math.abs(drift! * 100).toFixed(0)}% vs the price on file
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-end">
        {editing ? (
          <form
            action={async (formData) => {
              await updateOfferPrice(formData);
              onDoneEditing();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="offer_id" value={r.offerId} />
            <input type="hidden" name="vendor_id" value={vendorId} />
            <label className="flex items-center gap-1.5 text-xs text-ink/60">
              {r.priceLabel} $
              <input
                name="pack_price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={r.packPrice ?? ""}
                className="input w-24 py-1"
              />
            </label>
            <SubmitButton className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-ink hover:bg-gold-deep">
              Save
            </SubmitButton>
            <button type="button" onClick={onDoneEditing} className="px-1 py-1.5 text-xs text-ink/55 underline">
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="text-right">
              <span className="block font-mono text-sm text-ink">
                {r.price ?? <span className="font-sans text-gold-deep">No price yet</span>}
              </span>
              {r.perUnit && <span className="block font-mono text-xs text-ink/50">{r.perUnit}</span>}
            </span>
            {canEdit && (
              <button type="button" onClick={onEdit} className="px-1 py-1.5 text-xs text-ink/60 underline hover:text-ink">
                {r.packPrice == null ? "Add price" : "Edit price"}
              </button>
            )}
          </>
        )}

        {r.status === "pending" && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold-deep">waiting for review</span>
            {canApprove && (
              <>
                <form action={reviewOffer}>
                  <input type="hidden" name="offer_id" value={r.offerId} />
                  <input type="hidden" name="decision" value="approved" />
                  <SubmitButton className="px-1 py-1.5 text-xs text-palm hover:underline">Approve</SubmitButton>
                </form>
                <form action={reviewOffer}>
                  <input type="hidden" name="offer_id" value={r.offerId} />
                  <input type="hidden" name="decision" value="rejected" />
                  <SubmitButton className="px-1 py-1.5 text-xs text-maroon/70 hover:underline">Reject</SubmitButton>
                </form>
              </>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
