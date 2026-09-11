"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { shrinkImageForUpload, MAX_UPLOAD_BYTES, formatBytes } from "@/lib/image-resize";
import { PACKAGING, packagingLabel, packagingWord } from "@/lib/pack-description";
import { useReportPending } from "@/components/pending";
import {
  readProductPhotosAction,
  saveProductsAction,
  type PhotoProductDraft,
  type ProductToSave,
  type SavedProduct,
} from "./actions";
import type { ProductUnit } from "@/lib/product-extraction";
import { isPriceListFile } from "@/lib/price-list-file";

type Photo = { file: File; url: string };

type Draft = {
  key: string;
  include: boolean;
  match: PhotoProductDraft["match"];
  /** Filed against the Pricelist item it matched, rather than added as new. */
  useExisting: boolean;
  /** One of the matched item's pack ids, "new" for the size described below, "" for not chosen. */
  packChoice: string;
  name: string;
  brand: string;
  printedName: string | null;
  soldAs: string;
  innerQuantity: string;
  unit: ProductUnit;
  packCount: string;
  price: string;
  priceIsPer: "pack" | "unit";
  category: string;
};

const UNIT_OPTIONS: { value: ProductUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
  { value: "L", label: "L" },
  { value: "mL", label: "mL" },
  { value: "each", label: "items" },
];

const MAX_PHOTOS = 4;

function toDraft(p: PhotoProductDraft, i: number, total: number): Draft {
  const existing = !!p.match?.itemId && p.match.confidence !== "none";
  return {
    key: `${i}-${p.name}`,
    include: total === 1 || p.price != null,
    match: p.match,
    useExisting: existing,
    packChoice: existing ? (p.match?.packSizeId ?? (p.match && p.match.packs.length > 0 ? "" : "new")) : "new",
    name: p.name,
    brand: p.brand ?? "",
    printedName: p.printedName,
    soldAs: p.soldAs ?? "",
    innerQuantity: p.innerQuantity != null ? String(p.innerQuantity) : "",
    unit: p.unit ?? "each",
    packCount: p.packCount != null ? String(p.packCount) : "1",
    price: p.price != null ? String(p.price) : "",
    priceIsPer: p.priceIsPer ?? (p.soldAs === "loose" ? "unit" : "pack"),
    category: p.category ?? "",
  };
}

/**
 * Adding to the Pricelist from a phone, standing at a shelf.
 *
 * Take a photo, read it, check what was read, save. Everything the Pricelist
 * needs is asked for in plain words — what it is, what it comes in, how much
 * is in it, what it costs — and the item, pack size and price are built from
 * those answers on the server. A supplier's price list reads into several
 * products at once, each with its own tick.
 */
export function AddByPhotoForm({
  vendor,
  categories,
}: {
  vendor: { id: string; name: string } | null;
  categories: string[];
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [storeName, setStoreName] = useState(vendor?.name ?? "");
  const [phase, setPhase] = useState<"capture" | "reading" | "review" | "saving" | "done">("capture");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedProduct[]>([]);
  const [savedVendorId, setSavedVendorId] = useState<string | null>(vendor?.id ?? null);

  useReportPending(phase === "reading" || phase === "saving");

  // Object URLs for the thumbnails are released when the photos go.
  useEffect(() => {
    return () => photos.forEach((p) => URL.revokeObjectURL(p.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const chosen = [...(input.files ?? [])];
    input.value = "";
    setError(null);
    const added: Photo[] = [];
    for (const file of chosen.slice(0, MAX_PHOTOS - photos.length)) {
      const prepared = await shrinkImageForUpload(file);
      if (prepared.size > MAX_UPLOAD_BYTES) {
        setError(`That file is ${formatBytes(prepared.size)}, which is too large. Try a photo rather than a scan.`);
        continue;
      }
      added.push({ file: prepared, url: prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : "" });
    }
    setPhotos((current) => [...current, ...added].slice(0, MAX_PHOTOS));
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const gone = current[index];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return current.filter((_, i) => i !== index);
    });
  }

  async function read() {
    setError(null);
    setPhase("reading");
    const payload = new FormData();
    for (const p of photos) payload.append("photos", p.file);
    payload.append("vendor_name", vendor?.name ?? storeName);
    try {
      const result = await readProductPhotosAction(payload);
      if (result.error) {
        setError(result.error);
        setPhase("capture");
        return;
      }
      setDrafts(result.products.map((p, i) => toDraft(p, i, result.products.length)));
      setNote(result.note);
      if (!vendor && !storeName.trim() && result.store) setStoreName(result.store);
      setPhase("review");
    } catch {
      setError("Couldn't read that just now. Check the connection and try again.");
      setPhase("capture");
    }
  }

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  async function save() {
    setError(null);
    const chosen = drafts.filter((d) => d.include);
    if (chosen.length === 0) {
      setError("Tick at least one product to save.");
      return;
    }
    if (!vendor && !storeName.trim()) {
      setError("Say which store or supplier this is from.");
      return;
    }
    const unsized = chosen.find((d) => d.useExisting && d.packChoice === "");
    if (unsized) {
      setError(`Choose which size of ${unsized.match?.itemName ?? unsized.name} this is.`);
      return;
    }
    const unnamed = chosen.find((d) => !d.useExisting && !d.name.trim());
    if (unnamed) {
      setError("Every new item needs a name.");
      return;
    }

    const products: ProductToSave[] = chosen.map((d) => {
      const describesSize = !d.useExisting || d.packChoice === "new";
      return {
        itemId: d.useExisting ? (d.match?.itemId ?? null) : null,
        packSizeId: d.useExisting && d.packChoice && d.packChoice !== "new" ? d.packChoice : null,
        name: d.useExisting ? (d.match?.itemName ?? d.name) : d.name,
        brand: d.brand.trim() || null,
        printedName: d.printedName,
        soldAs: describesSize ? d.soldAs || null : null,
        innerQuantity: describesSize && d.innerQuantity ? Number(d.innerQuantity) : null,
        unit: d.unit,
        packCount: describesSize && d.packCount ? Number(d.packCount) : null,
        price: d.price ? Number(d.price) : null,
        priceIsPer: d.soldAs === "loose" ? "unit" : d.priceIsPer,
        category: d.useExisting ? null : d.category || null,
      };
    });

    setPhase("saving");
    try {
      const result = await saveProductsAction({ vendorId: vendor?.id ?? null, vendorName: storeName, products });
      setSaved(result.saved);
      setSavedVendorId(result.vendorId);
      if (result.error) {
        setError(result.error);
        setPhase(result.saved.length > 0 ? "done" : "review");
        return;
      }
      setPhase("done");
    } catch {
      setError("Couldn't save just now. Check the connection and try again.");
      setPhase("review");
    }
  }

  function startAgain() {
    photos.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setPhotos([]);
    setDrafts([]);
    setNote(null);
    setError(null);
    setSaved([]);
    setPhase("capture");
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-palm/30 bg-palm/5 p-5">
        <p className="section-title text-ink">
          Saved {saved.length} {saved.length === 1 ? "product" : "products"}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {saved.map((s) => (
            <li key={s.itemId + s.name}>
              <span className="text-palm">✓</span> <span className="font-medium text-ink">{s.name}</span>
              {s.priceText && <span className="text-ink/70"> — {s.priceText}</span>}
              {s.keptPrice && (
                <span className="block text-xs text-ink/55">
                  A different price was already on file, so it was kept for someone who edits the Pricelist to
                  review.
                </span>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startAgain}
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep"
          >
            Add another
          </button>
          <Link
            href={savedVendorId ? `/vendors/${savedVendorId}?tab=products` : "/pricelist"}
            className="rounded-md border border-ink/15 px-5 py-2.5 text-ink/70 hover:border-ink/30"
          >
            Done
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Store or supplier</span>
        {vendor ? (
          <p className="font-medium text-ink">{vendor.name}</p>
        ) : (
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="e.g. Woolworths Auburn — or leave it to the photo"
            className="input"
          />
        )}
      </div>

      {(phase === "capture" || phase === "reading") && (
        <div className="flex flex-col gap-4 rounded-lg border-2 border-dashed border-ink/20 bg-white/50 p-5">
          {photos.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <li key={p.url || `${p.file.name}-${i}`} className="relative">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-24 w-24 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-md bg-ink/5 p-2 text-center text-xs text-ink/60">
                      {p.file.name}
                    </div>
                  )}
                  {phase === "capture" && (
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-cream"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {phase === "reading" ? (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <p className="text-sm text-ink/70">
                {photos.some((p) => isPriceListFile(p.file))
                  ? "Reading the price list — a long one can take a couple of minutes…"
                  : `Reading the photo${photos.length === 1 ? "" : "s"}…`}
              </p>
              <span className="inline-progress" aria-hidden="true" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {photos.length < MAX_PHOTOS && (
                  <label
                    className={`cursor-pointer rounded-md px-5 py-3 font-medium ${
                      photos.length === 0 ? "bg-gold text-ink hover:bg-gold-deep" : "border border-ink/15 bg-white text-ink"
                    }`}
                  >
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={addPhotos} />
                    {photos.length === 0 ? "Take a photo" : "Add another photo"}
                  </label>
                )}
                {photos.length < MAX_PHOTOS && (
                  <label className="cursor-pointer rounded-md border border-ink/15 bg-white px-4 py-3 text-sm text-ink/70">
                    <input
                      type="file"
                      accept="image/*,application/pdf,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      multiple
                      className="hidden"
                      onChange={addPhotos}
                    />
                    Choose files or a price list
                  </label>
                )}
                {photos.length > 0 && (
                  <button
                    type="button"
                    onClick={read}
                    className="rounded-md bg-ink px-5 py-3 font-medium text-cream hover:bg-ink/90"
                  >
                    {photos.some((p) => isPriceListFile(p.file))
                      ? "Read price list"
                      : `Read ${photos.length === 1 ? "photo" : `${photos.length} photos`}`}
                  </button>
                )}
              </div>
              <p className="text-xs text-ink/50">
                {photos.length === 0
                  ? "The price tag and the product's label together read best. A supplier's price list works too."
                  : "Add the label as well if the size isn't on the tag, then read."}
              </p>
            </>
          )}
        </div>
      )}

      {(phase === "review" || phase === "saving") && (
        <div className="flex flex-col gap-4">
          {note && <p className="rounded-md bg-gold/10 px-3 py-2 text-sm text-ink/70">{note}</p>}
          {drafts.length > 1 && (
            <p className="text-sm text-ink/60">
              {drafts.length} products read. Untick any you don&apos;t want to save.
            </p>
          )}
          {drafts.map((d) => (
            <DraftCard
              key={d.key}
              draft={d}
              many={drafts.length > 1}
              categories={categories}
              onChange={(patch) => update(d.key, patch)}
            />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {(phase === "review" || phase === "saving") && (
        <div className="sticky bottom-0 z-30 -mx-4 flex gap-3 border-t border-ink/10 bg-cream/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
          <button
            type="button"
            onClick={save}
            disabled={phase === "saving"}
            className="flex-1 rounded-md bg-gold px-5 py-3 font-medium text-ink hover:bg-gold-deep disabled:opacity-60 sm:flex-none"
          >
            {phase === "saving"
              ? "Saving…"
              : `Save ${drafts.filter((d) => d.include).length > 1 ? `${drafts.filter((d) => d.include).length} products` : ""}`.trim()}
          </button>
          <button
            type="button"
            onClick={startAgain}
            disabled={phase === "saving"}
            className="rounded-md border border-ink/15 px-5 py-3 text-ink/70 hover:border-ink/30"
          >
            Start again
          </button>
        </div>
      )}
    </div>
  );
}

function DraftCard({
  draft: d,
  many,
  categories,
  onChange,
}: {
  draft: Draft;
  many: boolean;
  categories: string[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const loose = d.soldAs === "loose";
  const describesSize = !d.useExisting || d.packChoice === "new";
  const word = loose ? null : packagingWord(d.soldAs || null);
  const unitWord = UNIT_OPTIONS.find((u) => u.value === d.unit)?.label ?? d.unit;

  return (
    <div className={`flex flex-col gap-3 rounded-lg border bg-white/70 p-4 ${d.include ? "border-ink/10" : "border-ink/5 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words text-ink">{d.useExisting ? (d.match?.itemName ?? d.name) : d.name || "New item"}</p>
          {d.printedName && <p className="text-xs text-ink/50">Read as “{d.printedName}”</p>}
        </div>
        {many && (
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink/70">
            <input type="checkbox" checked={d.include} onChange={(e) => onChange({ include: e.target.checked })} />
            Save
          </label>
        )}
      </div>

      {d.match?.itemId && d.match.confidence !== "none" ? (
        d.useExisting ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-palm/5 px-3 py-2 text-sm">
            <span className="text-palm">✓ Already on the Pricelist:</span>
            <span className="text-ink">{d.match.itemName}</span>
            {d.match.itemNumber && <span className="font-mono text-xs text-ink/45">{d.match.itemNumber}</span>}
            <button
              type="button"
              onClick={() => onChange({ useExisting: false, packChoice: "new" })}
              className="text-xs text-ink/55 underline hover:text-ink"
            >
              No, it&apos;s a different product
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink/60">
            Adding as a new item.{" "}
            <button
              type="button"
              onClick={() =>
                onChange({
                  useExisting: true,
                  packChoice: d.match?.packSizeId ?? (d.match && d.match.packs.length > 0 ? "" : "new"),
                })
              }
              className="underline hover:text-ink"
            >
              It&apos;s {d.match.itemName} after all
            </button>
          </p>
        )
      ) : (
        <p className="text-sm text-ink/60">New item — it will be added to the Pricelist.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!d.useExisting && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">What is it?</span>
            <input value={d.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Basmati Rice" className="input" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Brand <span className="text-ink/40">(optional)</span>
          </span>
          <input value={d.brand} onChange={(e) => onChange({ brand: e.target.value })} className="input" />
        </label>

        {d.useExisting && d.match && d.match.packs.length > 0 && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">Which size?</span>
            <select value={d.packChoice} onChange={(e) => onChange({ packChoice: e.target.value })} className="input">
              <option value="">— choose —</option>
              {d.match.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
              <option value="new">A different size (describe it below)</option>
            </select>
          </label>
        )}

        {describesSize && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">How is it sold?</span>
              <select value={d.soldAs} onChange={(e) => onChange({ soldAs: e.target.value })} className="input">
                <option value="">— choose —</option>
                <option value="loose">Loose, by weight or each</option>
                {PACKAGING.map((p) => (
                  <option key={p} value={p}>
                    In a {p}
                  </option>
                ))}
              </select>
            </label>

            {loose ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Priced per</span>
                <select value={d.unit} onChange={(e) => onChange({ unit: e.target.value as ProductUnit })} className="input">
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.value === "each" ? "item" : u.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">How much is in {d.soldAs ? `the ${word}` : "it"}?</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={d.innerQuantity}
                    onChange={(e) => onChange({ innerQuantity: e.target.value })}
                    aria-label="Amount"
                    className="input w-24"
                  />
                  <select
                    value={d.unit}
                    onChange={(e) => onChange({ unit: e.target.value as ProductUnit })}
                    aria-label="Unit"
                    className="input w-28"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {!loose && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">How many in the {word ?? "pack"}?</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  value={d.packCount}
                  onChange={(e) => onChange({ packCount: e.target.value })}
                  className="input w-24"
                />
                <span className="text-xs text-ink/45">1, unless it holds several smaller packs</span>
              </label>
            )}
          </>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Price</span>
          <div className="flex items-center gap-2">
            <span className="text-ink/60">$</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={d.price}
              onChange={(e) => onChange({ price: e.target.value })}
              aria-label="Price"
              className="input w-28"
            />
            <span className="text-ink/60">
              {loose || d.priceIsPer === "unit"
                ? `per ${d.unit === "each" ? "item" : unitWord}`
                : `for the whole ${d.soldAs ? packagingLabel(d.soldAs).toLowerCase() : "pack"}`}
            </span>
          </div>
          {!loose && (
            <button
              type="button"
              onClick={() => onChange({ priceIsPer: d.priceIsPer === "pack" ? "unit" : "pack" })}
              className="self-start text-xs text-ink/55 underline hover:text-ink"
            >
              {d.priceIsPer === "pack"
                ? `It's the price per ${d.unit === "each" ? "item" : unitWord}`
                : `It's the price for the whole ${word ?? "pack"}`}
            </button>
          )}
        </div>

        {!d.useExisting && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Category</span>
            <select value={d.category} onChange={(e) => onChange({ category: e.target.value })} className="input">
              <option value="">— not sure —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
