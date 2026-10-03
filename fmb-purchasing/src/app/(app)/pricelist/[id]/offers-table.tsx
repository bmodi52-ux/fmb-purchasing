"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnchoredPopover } from "@/components/anchored-popover";
import { useReportPending } from "@/components/pending";
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
import { OfferForm, type OfferPack } from "./offer-form";
import { MoveOfferPanel } from "./move-offer-panel";

type Vendor = { id: string; name: string; vendor_number: string | null };

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
 * A row opens in place to the offer's fields, in two short rows, so the other
 * offers stay in view while one is being changed. What is wanted less often —
 * its history, the receipt, moving or retiring it — is a button away rather
 * than laid out beside the form.
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
  const close = useCallback(() => setOpenId(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  const live = useMemo(() => sortOffers(offers.filter((o) => o.status !== "rejected"), sort), [offers, sort]);
  const rejected = useMemo(() => sortOffers(offers.filter((o) => o.status === "rejected"), sort), [offers, sort]);
  const cheapest = useMemo(() => cheapestOfferId(offers), [offers]);
  const packById = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs]);

  const unit = unitName(unitCode) || "unit";
  const perUnit = `Per ${unit}`;
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

  const addForm = packs.length > 0 && (
    <OfferForm
      action={addOffer}
      itemId={itemId}
      packs={packs}
      packSizeId={packs[0]!.id}
      vendors={vendors}
      submitLabel="Add offer"
      onSaved={closeAdd}
      onCancel={closeAdd}
    />
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
        onClose={close}
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
              <div className="rounded-lg border border-ink/10 bg-cream p-3">{detail(o)}</div>
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
            Who sells it and for how much, cheapest per {unit} first.
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
        <div className="mb-4 rounded-lg border border-ink/10 bg-cream p-3">
          <p className="mb-2 text-sm font-medium text-ink">New offer</p>
          {addForm}
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

const QUIET = "btn btn-quiet btn-xs";

/**
 * What is behind an offer's row: its fields, and on the same line as Save the
 * things wanted less often. History and moving the offer open underneath when
 * asked for; nothing but the fields is on show until then.
 */
function OfferDetail({
  offer: o,
  pack,
  itemId,
  packs,
  vendors,
  canEdit,
  canApprove,
  onClose,
}: {
  offer: OfferRow;
  pack: OfferPack | undefined;
  itemId: string;
  packs: OfferPack[];
  vendors: Vendor[];
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
}) {
  // Somebody who may only look has no form to see, so the history is what
  // opening the row is for.
  const [showing, setShowing] = useState<"history" | "move" | null>(canEdit ? null : "history");
  const show = (what: "history" | "move") => setShowing((current) => (current === what ? null : what));

  const extras = (
    <>
      <button type="button" onClick={() => show("history")} aria-expanded={showing === "history"} className={QUIET}>
        History{o.history.length > 0 && ` (${o.history.length})`}
      </button>
      {o.source?.canOpen && o.source.hasReceipt && (
        <ReceiptViewer expenseId={o.source.expenseId} className={QUIET} />
      )}
      {canEdit && <MoreMenu offer={o} itemId={itemId} canApprove={canApprove} onMove={() => show("move")} />}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {canEdit && pack ? (
        <OfferForm
          action={updateOffer}
          itemId={itemId}
          packs={packs}
          packSizeId={o.packSizeId}
          offerId={o.id}
          vendorId={o.vendorId}
          brand={o.brand}
          vendorSku={o.vendorSku}
          storeProductName={o.storeProductName}
          packPrice={o.packPrice}
          comments={o.comments}
          vendors={vendors}
          submitLabel="Save"
          onSaved={onClose}
          onCancel={onClose}
          footer={extras}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-1">{extras}</div>
      )}

      {showing === "history" && (
        <div className="border-t border-ink/10 pt-3">
          {o.history.length === 0 ? (
            <p className="text-support text-ink/60">No changes recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-support">
              {o.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-3">
                  <span className="whitespace-nowrap text-ink/45">
                    {h.when}
                    {h.by && ` · ${h.by}`}
                  </span>
                  <span className="text-ink/75">
                    {h.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showing === "move" && (
        <div className="border-t border-ink/10 pt-3">
          <MoveOfferPanel
            offerId={o.id}
            itemId={itemId}
            offerLabel={`${o.vendorName ?? "this offer"}, ${pack?.title ?? ""}`}
            purchaseCount={o.lineCount}
            onCancel={() => setShowing(null)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The ways out of an offer — move it to another item, retire it, delete it —
 * behind one button, because they are wanted rarely and two of them cannot be
 * taken back.
 *
 * Through AnchoredPopover, since the table scrolls sideways and would clip a
 * menu positioned inside it. Its choices call the actions directly rather
 * than through forms of their own: the menu is opened from inside the offer's
 * form, and a form cannot hold another.
 */
function MoreMenu({
  offer: o,
  itemId,
  canApprove,
  onMove,
}: {
  offer: OfferRow;
  itemId: string;
  canApprove: boolean;
  onMove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  useReportPending(pending);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (action: (formData: FormData) => Promise<void>) =>
    startTransition(async () => {
      const formData = new FormData();
      formData.set("offer_id", o.id);
      formData.set("item_id", itemId);
      await action(formData);
      setOpen(false);
    });

  const item = "block w-full px-3 py-2 text-left hover:bg-gold/10 disabled:opacity-55";
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={QUIET}
      >
        More
        <Chevron up={open} />
      </button>
      <AnchoredPopover anchorRef={buttonRef} open={open} minWidth={220} align="end">
        <div ref={menuRef} role="menu" className="py-1 text-sm">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onMove();
            }}
            className={`${item} text-ink`}
          >
            Wrong item? Move it
          </button>
          {o.lineCount === 0 && (
            <button type="button" role="menuitem" disabled={pending} onClick={() => run(deleteOffer)} className={`${item} text-danger`}>
              Delete offer
            </button>
          )}
          {/* Delete would orphan the purchases, so an offer that has some is
              retired instead: nothing new matches it, and what it has keeps
              counting. A pending one an approver can already reject. */}
          {o.lineCount > 0 && o.status !== "rejected" && !(canApprove && o.status === "pending") && (
            <button type="button" role="menuitem" disabled={pending} onClick={() => run(retireOffer)} className={`${item} text-danger`}>
              Retire offer
            </button>
          )}
        </div>
      </AnchoredPopover>
    </>
  );
}
