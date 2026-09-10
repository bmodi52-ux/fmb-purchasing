"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/dialog";
import { SubmitButton } from "@/components/submit-button";
import { formatUnitCost } from "@/lib/pack-description";
import { addVendorOffer, type AddVendorOfferState } from "../../pricelist/actions";

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

/** "+ Add pricing for an existing item", on a vendor's page. */
export function AddOfferModal({
  vendorId,
  vendorName,
  items,
}: {
  vendorId: string;
  vendorName: string;
  items: OfferableItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start whitespace-nowrap rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink transition-colors hover:border-ink/30"
      >
        + Add pricing for an existing item
      </button>

      {open && (
        <Dialog title={`Add pricing from ${vendorName}`} align="start" onClose={() => setOpen(false)}>
          <AddOfferForm
            vendorId={vendorId}
            vendorName={vendorName}
            items={items}
            onSuccess={() => setOpen(false)}
          />
        </Dialog>
      )}
    </>
  );
}

function AddOfferForm({
  vendorId,
  vendorName,
  items,
  onSuccess,
}: {
  vendorId: string;
  vendorName: string;
  items: OfferableItem[];
  onSuccess: () => void;
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
            <span className="text-ink/70">Find the item</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or item number"
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
                    className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-gold/10"
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
              <li className="px-3 py-2 text-sm text-ink/50">
                Nothing on the Pricelist matches &ldquo;{query}&rdquo;. Close this and use + New item to add it.
              </li>
            )}
          </ul>
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
              <span className="text-ink/70">Pack size</span>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex gap-2 sm:col-span-2">
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    <span className="text-ink/70">{pack.priceLabel}</span>
                    <input
                      name="pack_price"
                      type="number"
                      step="any"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="input"
                    />
                  </label>
                  <div className="flex w-36 flex-col gap-1 text-sm">
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
