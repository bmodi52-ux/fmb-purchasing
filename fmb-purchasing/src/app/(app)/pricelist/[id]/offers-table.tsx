"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { formatPlainDate } from "@/lib/format";
import { formatUnitCost, unitName } from "@/lib/pack-description";
import {
  DEFAULT_OFFER_SORT,
  cheapestOfferId,
  priceDrift,
  sortOffers,
  type OfferSort,
  type OfferSortKey,
  type SortableOffer,
} from "@/lib/item-offers";
import { addOffer, deleteOffer, retireOffer, reviewOffer, updateOffer } from "../actions";
import { OfferForm } from "./offer-form";
import { MoveOfferPanel } from "./move-offer-panel";

type Vendor = { id: string; name: string; vendor_number: string | null };

/** A pack size an offer can be for, with what its forms need to say. */
export type OfferPack = {
  id: string;
  title: string;
  /** "Price per box" — what an entered price is for. */
  priceLabel: string;
  totalQuantity: number;
  unitLabel: string | null;
};

/** The receipt an offer's details came from (#58). */
export type OfferSource = {
  expenseId: string;
  expenseNumber: string | null;
  /** Whether this viewer may open the expense and its receipt. */
  canOpen: boolean;
  hasReceipt: boolean;
};

export type OfferHistoryEntry = {
  id: string;
  when: string;
  by: string | null;
  changes: { label: string; from: string; to: string }[];
};

export type OfferRow = SortableOffer & {
  id: string;
  status: string;
  vendorId: string | null;
  vendorNumber: string | null;
  vendorSku: string | null;
  storeProductName: string | null;
  comments: string | null;
  packSizeId: string;
  baseUnitCode: string | null;
  /** The day the price was set, YYYY-MM-DD. */
  priceSetOn: string | null;
  source: OfferSource | null;
  /** A special still running today. */
  special: { price: number; endsOn: string; assumed: boolean } | null;
  gstAdded: boolean;
  sourceUrl: string | null;
  lastPaidOn: string | null;
  /** Every receipt line filed against it: what decides delete or retire. */
  lineCount: number;
  history: OfferHistoryEntry[];
};

const money = (n: number) => `$${n.toFixed(2)}`;

/** Still missing something only a person can supply, so nobody can approve it yet. */
const unfinished = (o: OfferRow) => o.status === "pending" && (o.packPrice == null || !o.vendorId);

/** Clicks on a row open it, unless they landed on something with a job of its own. */
const ownsItsClick = (target: EventTarget) =>
  (target as HTMLElement).closest("a, button, input, select, textarea, form, details") != null;

/**
 * Who sells an item and for how much, one row per offer.
 *
 * The item page listed offers as cards nested under their pack size, in the
 * order they were created, so finding the cheapest meant reading every card.
 * One table across every pack sorts them by cost per unit — the figure that
 * compares a 1 kg bag with a 5 kg tub — and puts what was last paid beside
 * the price on file, so a price that has drifted shows on its own row.
 *
 * Everything else about an offer (its form, where the price came from, its
 * history, moving or retiring it) is behind the row, and opens in place, so the
 * other offers stay in view while one is being changed.
 */
export function OffersTable({
  itemId,
  offers,
  packs,
  vendors,
  unitCode,
  canEdit,
  canApprove,
}: {
  itemId: string;
  offers: OfferRow[];
  packs: OfferPack[];
  vendors: Vendor[];
  /** What the item is costed in, for the per-unit heading. */
  unitCode: string | null;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const [sort, setSort] = useState<OfferSort>(DEFAULT_OFFER_SORT);
  const [openId, setOpenId] = useState<string | null>(() =>
    canEdit ? (offers.find((o) => o.status !== "rejected" && unfinished(o))?.id ?? null) : null
  );
  const [showRejected, setShowRejected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addPackId, setAddPackId] = useState(packs[0]?.id ?? "");
  const close = useCallback(() => setOpenId(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  const live = useMemo(() => sortOffers(offers.filter((o) => o.status !== "rejected"), sort), [offers, sort]);
  const rejected = useMemo(() => sortOffers(offers.filter((o) => o.status === "rejected"), sort), [offers, sort]);
  const cheapest = useMemo(() => cheapestOfferId(offers), [offers]);
  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);

  const perUnit = `Per ${unitName(unitCode) || "unit"}`;
  const columns: { key: OfferSortKey; label: string; right?: boolean }[] = [
    { key: "vendor", label: "Vendor" },
    { key: "brand", label: "Brand" },
    { key: "pack", label: "Pack" },
    { key: "price", label: "Price on file", right: true },
    { key: "perUnit", label: perUnit, right: true },
    { key: "lastPaid", label: "Last paid", right: true },
    { key: "bought", label: "Bought", right: true },
  ];

  function toggleSort(key: OfferSortKey) {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    );
  }
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  const addPack = packById.get(addPackId) ?? packs[0];
  const addForm = addPack && (
    <div className="flex flex-col gap-3">
      {packs.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Pack size</span>
          <select value={addPack.id} onChange={(e) => setAddPackId(e.target.value)} className="input">
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <OfferForm
        key={addPack.id}
        action={addOffer}
        itemId={itemId}
        packSizeId={addPack.id}
        priceLabel={addPack.priceLabel}
        totalQuantity={addPack.totalQuantity}
        innerUnitLabel={addPack.unitLabel}
        vendors={vendors}
        submitLabel="Add offer"
        onSaved={closeAdd}
      />
    </div>
  );

  const vendorCell = (o: OfferRow) => (
    <>
      {o.vendorNumber && <span className="mr-1.5 tabular-nums text-support text-ink/45">{o.vendorNumber}</span>}
      <span className="font-medium text-ink">
        {o.vendorId ? (o.vendorName ?? "A vendor since removed") : "— no vendor —"}
      </span>
      {o.status !== "approved" && (
        <span className="ml-2">
          <StatusBadge status={o.status} label={o.status === "pending" ? "Waiting for review" : undefined} />
        </span>
      )}
      {(o.vendorSku || o.storeProductName) && (
        <span className="mt-0.5 block text-support text-ink/55">
          {o.vendorSku && <span className="tabular-nums">#{o.vendorSku}</span>}
          {o.vendorSku && o.storeProductName && " · "}
          {/* What the store calls it (#43). */}
          {o.storeProductName && <>&ldquo;{o.storeProductName}&rdquo;</>}
        </span>
      )}
      {/* What a receipt filled in (#79) is only ever a reading of the invoice,
          so it waits here to be checked. */}
      {o.status === "pending" && o.lineCount > 0 && (
        <span className="mt-0.5 block text-support text-gold-deep">
          Filled in from a receipt: check the pack, brand, product code and price{canApprove ? ", then approve." : "."}
        </span>
      )}
      {o.comments && <span className="mt-0.5 block text-support text-ink/60">{o.comments}</span>}
    </>
  );

  const priceCell = (o: OfferRow) => (
    <>
      <span className="tabular-nums">{o.packPrice != null ? money(o.packPrice) : <span className="text-gold-deep">No price yet</span>}</span>
      {o.special && (
        <span className="mt-0.5 block text-support whitespace-nowrap text-palm">
          On special {money(o.special.price)} until {formatPlainDate(o.special.endsOn)}
          {o.special.assumed && " (end date assumed)"}
        </span>
      )}
      {/* Where the price came from and when (#46, #58). Prices don't expire, so
          the date is how an old one shows. */}
      {(o.source || o.priceSetOn) && (
        <span className="mt-0.5 block text-support text-ink/55">
          <span className="whitespace-nowrap">{o.source ? <SourceLink source={o.source} prefix="receipt " /> : "set"}</span>
          {o.priceSetOn && <span className="whitespace-nowrap"> · {formatPlainDate(o.priceSetOn)}</span>}
        </span>
      )}
      {o.status === "pending" && o.source?.canOpen && o.source.hasReceipt && (
        <span className="mt-0.5 block text-support">
          <ReceiptViewer expenseId={o.source.expenseId} />
        </span>
      )}
      {(o.gstAdded || o.sourceUrl) && (
        <span className="mt-0.5 block text-support text-ink/55">
          {o.gstAdded && "+GST added"}
          {o.gstAdded && o.sourceUrl && " · "}
          {o.sourceUrl && (
            <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              shop&apos;s page
            </a>
          )}
        </span>
      )}
    </>
  );

  const perUnitCell = (o: OfferRow) =>
    o.costPerUnit != null ? (
      <>
        <span className="tabular-nums whitespace-nowrap">{formatUnitCost(o.costPerUnit, o.baseUnitCode)}</span>
        {o.id === cheapest && (
          <span className="mt-1 block">
            <span className="badge badge-good">Cheapest</span>
          </span>
        )}
      </>
    ) : (
      <span className="text-ink/45">—</span>
    );

  const lastPaidCell = (o: OfferRow) => {
    if (o.lastPaid == null) return <span className="whitespace-nowrap text-ink/45">Not bought yet</span>;
    const drift = priceDrift(o.lastPaid, o.packPrice);
    return (
      <>
        <span className="tabular-nums">{money(o.lastPaid)}</span>
        {o.lastPaidOn && <span className="mt-0.5 block text-support text-ink/55">{formatPlainDate(o.lastPaidOn)}</span>}
        {drift != null && (
          <span className={`mt-0.5 ml-auto block max-w-[9.5rem] text-support font-medium ${drift > 0 ? "text-danger" : "text-palm"}`}>
            {drift > 0 ? "▲" : "▼"} {Math.abs(drift * 100).toFixed(0)}% {drift > 0 ? "above" : "below"} the price on file
          </span>
        )}
      </>
    );
  };

  const boughtCell = (o: OfferRow) =>
    o.purchaseCount > 0 ? <span className="tabular-nums">{o.purchaseCount}×</span> : <span className="text-ink/45">—</span>;

  const actions = (o: OfferRow) => {
    const open = openId === o.id;
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-2">
        {canApprove && o.status === "pending" && (
          <>
            <form action={reviewOffer}>
              <input type="hidden" name="offer_id" value={o.id} />
              <input type="hidden" name="decision" value="approved" />
              <SubmitButton className="btn btn-approve btn-xs">Approve</SubmitButton>
            </form>
            <form action={reviewOffer}>
              <input type="hidden" name="offer_id" value={o.id} />
              <input type="hidden" name="decision" value="rejected" />
              <SubmitButton className="btn btn-danger btn-xs">Reject</SubmitButton>
            </form>
          </>
        )}
        <button
          type="button"
          onClick={() => toggle(o.id)}
          aria-expanded={open}
          aria-label={open ? "Close this offer" : "Open this offer"}
          className="rounded p-1 text-ink/45 hover:bg-ink/5 hover:text-ink"
        >
          <Chevron up={open} />
        </button>
      </span>
    );
  };

  const detail = (o: OfferRow) => {
    const pack = packById.get(o.packSizeId);
    return (
      <OfferDetail
        offer={o}
        pack={pack}
        itemId={itemId}
        packs={packs}
        vendors={vendors}
        canEdit={canEdit}
        canApprove={canApprove}
        onSaved={close}
      />
    );
  };

  const rowClass = (o: OfferRow, open: boolean) =>
    [
      "align-top",
      "cursor-pointer",
      open ? "bg-gold/[0.09]" : o.status === "pending" ? "bg-gold/[0.06] hover:bg-gold/[0.1]" : "hover:bg-gold/[0.07]",
      o.status === "rejected" ? "text-ink/55" : "",
    ].join(" ");

  const tableRow = (o: OfferRow) => {
    const open = openId === o.id;
    return (
      <Fragment key={o.id}>
        <tr
          className={`${rowClass(o, open)} ${open ? "" : "border-b border-ink/[0.06]"}`}
          onClick={(e) => {
            if (!ownsItsClick(e.target)) toggle(o.id);
          }}
        >
          {/* Wide enough that a long vendor or pack name wraps onto two lines
              rather than five; the table scrolls sideways before it crushes. */}
          <td className="min-w-[11rem] py-2.5 pr-4">{vendorCell(o)}</td>
          <td className="py-2.5 pr-4">{o.brand ?? <span className="text-ink/45">—</span>}</td>
          <td className="min-w-[7rem] py-2.5 pr-4">{packById.get(o.packSizeId)?.title ?? "—"}</td>
          <td className="py-2.5 pr-4 text-right">{priceCell(o)}</td>
          <td className="py-2.5 pr-4 text-right">{perUnitCell(o)}</td>
          <td className="py-2.5 pr-4 text-right">{lastPaidCell(o)}</td>
          <td className="py-2.5 pr-4 text-right">{boughtCell(o)}</td>
          <td className="py-2.5 text-right whitespace-nowrap">{actions(o)}</td>
        </tr>
        {open && (
          <tr className="border-b border-ink/10 bg-gold/[0.09]">
            <td colSpan={8} className="px-3 pb-4">
              <div className="rounded-lg border border-ink/10 bg-cream p-4">{detail(o)}</div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const card = (o: OfferRow) => {
    const open = openId === o.id;
    return (
      <li
        key={o.id}
        className={`rounded-md border border-ink/10 p-3 ${o.status === "pending" ? "bg-gold/[0.06]" : "bg-white"} ${
          o.status === "rejected" ? "text-ink/55" : ""
        }`}
      >
        <div>{vendorCell(o)}</div>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body">
          {(
            [
              ["Brand", o.brand ?? "—"],
              ["Pack", packById.get(o.packSizeId)?.title ?? "—"],
              ["Price on file", priceCell(o)],
              [perUnit, perUnitCell(o)],
              ["Last paid", lastPaidCell(o)],
              ["Bought", boughtCell(o)],
            ] as const
          ).map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-support text-ink/55">{label}</dt>
              <dd className="text-right">{value}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="mt-2 flex justify-end">{actions(o)}</div>
        {open && <div className="mt-3 border-t border-ink/10 pt-3">{detail(o)}</div>}
      </li>
    );
  };

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="section-title text-ink">Vendor offers</h2>
          <p className="mt-1 text-sm text-ink/50">
            Who sells it and for how much, cheapest {perUnit.toLowerCase()} first.
            <span className="hidden xl:inline"> Select a heading to sort.</span>
          </p>
        </div>
        {canEdit && packs.length > 0 && (
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className="btn btn-secondary">
            + Add offer
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-cream p-4">
          <p className="mb-3 text-sm font-medium text-ink">New offer</p>
          {addForm}
          <button type="button" onClick={closeAdd} className="mt-2 text-sm text-ink/55 underline hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {offers.length === 0 ? (
        <p className="text-sm text-ink/50">
          {packs.length === 0 ? "Add a pack size below, then the vendors that sell it." : "No vendor offers yet."}
        </p>
      ) : (
        <>
          {/* Phones show cards, which have no headings to tap — so sorting gets
              a control of its own there. */}
          <div className="mb-3 flex items-center gap-2 xl:hidden">
            <select
              value={sort.key}
              onChange={(e) => setSort({ key: e.target.value as OfferSortKey, direction: sort.direction })}
              aria-label="Sort by"
              className="input py-1 text-sm"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => toggleSort(sort.key)}
              className="rounded-md border border-ink/15 px-2 py-1.5 text-xs text-ink/70"
            >
              {sort.direction === "asc" ? "▲ asc" : "▼ desc"}
            </button>
          </div>

          <div className="hidden overflow-x-auto xl:block">
            <table className="min-w-full text-body">
              <thead>
                <tr className="border-b border-ink/15 text-left text-support text-ink/70">
                  {columns.map((c) => {
                    const sorted = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                        className={`pr-4 pb-2.5 font-semibold whitespace-nowrap ${c.right ? "text-right" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          title={`Sort by ${c.label}`}
                          className={`inline-flex items-center gap-1 font-semibold hover:text-ink ${sorted ? "text-ink" : ""}`}
                        >
                          {c.label}
                          {sorted && <span aria-hidden>{sort.direction === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className="pb-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {live.map(tableRow)}
                {live.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-sm text-ink/50">
                      Every offer for this item was rejected.
                    </td>
                  </tr>
                )}
                {showRejected && rejected.map(tableRow)}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 xl:hidden">
            {live.map(card)}
            {live.length === 0 && <li className="text-sm text-ink/50">Every offer for this item was rejected.</li>}
            {showRejected && rejected.map(card)}
          </ul>

          {/* Rejected offers are kept, not deleted: they are a record of a price
              somebody decided against, and the expense lines that pointed at
              them still do. Behind a button, because an item bought for years
              otherwise buries its live offers under everything turned down. */}
          {rejected.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRejected((s) => !s)}
              aria-expanded={showRejected}
              className="mt-3 text-sm text-ink/50 hover:text-ink"
            >
              {showRejected ? "Hide" : "Show"} {rejected.length} rejected
            </button>
          )}
        </>
      )}

    </section>
  );
}

/** "E-0127", a link for whoever may open the expense. */
function SourceLink({ source, prefix }: { source: OfferSource; prefix?: string }) {
  const label = source.expenseNumber ?? "an expense";
  return (
    <>
      {prefix}
      {source.canOpen ? (
        <Link href={`/expenses/${source.expenseId}`} className="tabular-nums underline underline-offset-2 hover:text-ink">
          {label}
        </Link>
      ) : (
        <span className="tabular-nums">{label}</span>
      )}
    </>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d={up ? "M5 12.5L10 7.5L15 12.5" : "M5 7.5L10 12.5L15 7.5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Everything about one offer that the row has no room for: its form, the
 * receipt its price came from, its history, and the ways out of it.
 */
function OfferDetail({
  offer: o,
  pack,
  itemId,
  packs,
  vendors,
  canEdit,
  canApprove,
  onSaved,
}: {
  offer: OfferRow;
  pack: OfferPack | undefined;
  itemId: string;
  packs: OfferPack[];
  vendors: Vendor[];
  canEdit: boolean;
  canApprove: boolean;
  onSaved: () => void;
}) {
  return (
    <div className={`grid gap-6 ${canEdit ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
      {canEdit && pack && (
        <OfferForm
          action={updateOffer}
          itemId={itemId}
          packSizeId={o.packSizeId}
          offerId={o.id}
          priceLabel={pack.priceLabel}
          totalQuantity={pack.totalQuantity}
          innerUnitLabel={pack.unitLabel}
          vendorId={o.vendorId}
          brand={o.brand}
          vendorSku={o.vendorSku}
          storeProductName={o.storeProductName}
          packPrice={o.packPrice}
          comments={o.comments}
          vendors={vendors}
          packSizes={packs.map((p) => ({ id: p.id, label: p.title }))}
          submitLabel="Save"
          onSaved={onSaved}
        />
      )}

      <div className={`flex flex-col gap-4 text-sm ${canEdit ? "border-t border-ink/10 pt-4 lg:border-0 lg:pt-0" : ""}`}>
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink/45 uppercase">Where the price came from</h3>
          {o.source ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-ink/70">
              <span>
                <SourceLink source={o.source} prefix="Receipt " />
                {o.priceSetOn && <> of {formatPlainDate(o.priceSetOn)}</>}
              </span>
              {o.source.canOpen && o.source.hasReceipt && (
                <>
                  <span className="text-ink/30">·</span>
                  <ReceiptViewer expenseId={o.source.expenseId} />
                </>
              )}
            </p>
          ) : (
            <p className="text-ink/70">
              {o.packPrice == null
                ? "No price has been entered yet."
                : o.priceSetOn
                  ? `Entered on ${formatPlainDate(o.priceSetOn)}, not from a receipt.`
                  : "Entered by hand, not from a receipt."}
            </p>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink/45 uppercase">
            History{o.history.length > 0 && ` · ${o.history.length}`}
          </h3>
          {o.history.length === 0 ? (
            <p className="text-ink/70">No changes recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {o.history.map((h) => (
                <li key={h.id} className="rounded border border-ink/10 bg-white p-2">
                  <p className="mb-0.5 text-xs text-ink/45">
                    {h.when}
                    {h.by && ` · ${h.by}`}
                  </p>
                  <ul>
                    {h.changes.map((c) => (
                      <li key={c.label} className="text-ink/70">
                        <span className="text-ink/45">{c.label}:</span> {c.from} → {c.to}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canEdit && (
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink/45 uppercase">More</h3>
            <div className="flex flex-col items-start gap-2 text-ink/60">
              <MoveOfferPanel
                offerId={o.id}
                itemId={itemId}
                offerLabel={`${o.vendorName ?? "this offer"}, ${pack?.title ?? ""}`}
                purchaseCount={o.lineCount}
              />
              {o.lineCount === 0 && (
                <form action={deleteOffer}>
                  <input type="hidden" name="offer_id" value={o.id} />
                  <input type="hidden" name="item_id" value={itemId} />
                  <SubmitButton className="text-danger/80 hover:underline">Delete offer</SubmitButton>
                </form>
              )}
              {/* Delete would orphan the purchases, so an offer that has some is
                  retired instead: nothing new matches it, and what it has keeps
                  counting. A pending one an approver can already reject. */}
              {o.lineCount > 0 && o.status !== "rejected" && !(canApprove && o.status === "pending") && (
                <form action={retireOffer}>
                  <input type="hidden" name="offer_id" value={o.id} />
                  <input type="hidden" name="item_id" value={itemId} />
                  <SubmitButton className="text-danger/80 hover:underline">Retire offer</SubmitButton>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
