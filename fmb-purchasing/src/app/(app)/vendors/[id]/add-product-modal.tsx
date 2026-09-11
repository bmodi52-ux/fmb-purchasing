"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/dialog";
import { SubmitButton } from "@/components/submit-button";
import { formatUnitCost } from "@/lib/pack-description";
import { addVendorOffer, type AddVendorOfferState } from "../../pricelist/actions";
import { AddItemForm } from "../../pricelist/add-item-form";

export type OfferablePack = {
  id: string;
  title: string;
  /** "Price per box" — what the price is a price for. */
  priceLabel: string;
  /** What one pack holds, in its own unit, so a price can be worked out per unit. */
  totalQuantity: number;
  unitLabel: string | null;
  /** This vendor already has live pricing on the pack. */
  alreadyPriced: boolean;
};

export type OfferableItem = {
  id: string;
  name: string;
  itemNumber: string | null;
  categoryName: string | null;
  packs: OfferablePack[];
};

const initialState: AddVendorOfferState = { error: null, success: false };

/**
 * "+ Add product" on a vendor's Products tab.
 *
 * There used to be two buttons — one to create an item, one to price an item
 * that already existed — which asked a person to know which case they were in
 * before looking. Guessing "new" is how duplicates are made. So this starts by
 * searching the Pricelist, and only offers to create an item once the search
 * has come up without it, carrying the name typed across.
 */
export function AddProductModal({
  vendorId,
  vendorName,
  items,
  categories,
  units,
}: {
  vendorId: string;
  vendorName: string;
  items: OfferableItem[];
  categories: { id: string; name: string }[];
  units: { id: string; code: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [newItemName, setNewItemName] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setNewItemName(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start whitespace-nowrap rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep"
      >
        + Add product
      </button>

      {open && (
        <Dialog
          title={newItemName === null ? `Add a product from ${vendorName}` : `New item from ${vendorName}`}
          align="start"
          onClose={close}
        >
          {newItemName === null ? (
            <PriceExistingForm
              vendorId={vendorId}
              vendorName={vendorName}
              items={items}
              onSuccess={close}
              onNewItem={(name) => setNewItemName(name)}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => setNewItemName(null)}
                className="self-start text-sm text-ink/60 underline hover:text-ink"
              >
                ← Back to searching the Pricelist
              </button>
              <AddItemForm
                vendors={[]}
                categories={categories}
                units={units}
                fixedVendor={{ id: vendorId, name: vendorName }}
                defaultName={newItemName}
                onSuccess={close}
              />
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function PriceExistingForm({
  vendorId,
  vendorName,
  items,
  onSuccess,
  onNewItem,
}: {
  vendorId: string;
  vendorName: string;
  items: OfferableItem[];
  onSuccess: () => void;
  onNewItem: (name: string) => void;
}) {
  const [state, formAction, pending] = useActionState(addVendorOffer, initialState);
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [packId, setPackId] = useState("");
  const [price, setPrice] = useState("");

  // Closing in response to the server action's result, which is an external
  // system rather than something derivable during render.
  useEffect(() => {
    if (state.success) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const item = items.find((i) => i.id === itemId) ?? null;
  const pack = item?.packs.find((p) => p.id === packId) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.itemNumber ?? "").toLowerCase().includes(q))
      : items;
    return found.slice(0, 8);
  }, [items, query]);

  const amount = Number(price);
  const costPerUnit =
    pack && amount && pack.totalQuantity ? Math.round((amount / pack.totalQuantity) * 10000) / 10000 : null;

  function chooseItem(next: OfferableItem) {
    setItemId(next.id);
    // One pack still open to price is the only sensible answer; more is a choice.
    const open = next.packs.filter((p) => !p.alreadyPriced);
    setPackId(open.length === 1 ? open[0]!.id : "");
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="vendor_id" value={vendorId} />

      {!item ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">What is it?</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the Pricelist — name or item number"
              className="input"
            />
          </label>
          <ul className="flex flex-col divide-y divide-ink/5 rounded-md border border-ink/10 bg-white">
            {matches.map((i) => {
              const openPacks = i.packs.filter((p) => !p.alreadyPriced).length;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => chooseItem(i)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2.5 text-left text-sm hover:bg-gold/10"
                  >
                    <span className="text-ink">
                      {i.name}
                      {i.itemNumber && <span className="ml-1.5 font-mono text-xs text-ink/45">{i.itemNumber}</span>}
                    </span>
                    <span className="text-xs text-ink/45">
                      {i.packs.length === 0
                        ? "no pack sizes yet"
                        : openPacks === 0
                          ? `already priced by ${vendorName}`
                          : `${i.packs.length} pack size${i.packs.length === 1 ? "" : "s"}`}
                    </span>
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink/50">Nothing on the Pricelist matches &ldquo;{query}&rdquo;.</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => onNewItem(query.trim())}
            className="self-start rounded-md border border-dashed border-ink/25 px-3 py-2 text-sm text-ink/75 hover:border-ink/45"
          >
            {query.trim() ? `Not listed? Add “${query.trim()}” as a new item` : "Not listed? Add a new item"}
          </button>
        </div>
      ) : (
        <>
          <input type="hidden" name="pack_size_id" value={packId} />

          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm">
            <span className="text-ink">
              {item.name}
              {item.itemNumber && <span className="ml-1.5 font-mono text-xs text-ink/45">{item.itemNumber}</span>}
            </span>
            <button
              type="button"
              onClick={() => {
                setItemId(null);
                setPackId("");
              }}
              className="text-xs text-ink/50 underline hover:text-ink"
            >
              Choose a different item
            </button>
          </div>

          {item.packs.length === 0 ? (
            <p className="text-sm text-ink/60">
              {item.name} has no pack sizes yet.{" "}
              <Link href={`/pricelist/${item.id}`} className="underline hover:text-ink">
                Add one on its page
              </Link>
              , then price it here.
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Which size?</span>
              <select value={packId} onChange={(e) => setPackId(e.target.value)} required className="input">
                <option value="">— choose —</option>
                {item.packs.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.alreadyPriced}>
                    {p.title}
                    {p.alreadyPriced ? ` — already priced by ${vendorName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {pack && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex gap-2 sm:col-span-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    <span className="text-ink/70">{pack.priceLabel}</span>
                    <input
                      name="pack_price"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="input"
                    />
                  </label>
                  <div className="flex w-36 shrink-0 flex-col gap-1 text-sm">
                    <span className="text-ink/70">Works out to</span>
                    <div className="input flex items-center bg-ink/[0.03] font-mono text-ink/70">
                      {costPerUnit != null ? formatUnitCost(costPerUnit, pack.unitLabel) : "—"}
                    </div>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">
                    Brand <span className="text-ink/40">(optional)</span>
                  </span>
                  <input name="brand" className="input" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">
                    Vendor&apos;s product code <span className="text-ink/40">(optional)</span>
                  </span>
                  <input name="vendor_sku" placeholder="as printed on their invoice" className="input" />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-ink/70">Comments</span>
                  <textarea name="comments" rows={2} className="input" />
                </label>
              </div>

              <SubmitButton
                disabled={pending}
                className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
              >
                {pending ? "Saving…" : "Add pricing"}
              </SubmitButton>
            </>
          )}
        </>
      )}

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
