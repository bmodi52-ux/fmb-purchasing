"use client";

import { Fragment, useCallback, useState } from "react";
import { PackSizeForm } from "./pack-size-form";
import { AddPackSizeForm } from "./add-pack-size-form";

type Unit = { id: string; code: string; label: string };

export type PackRow = {
  id: string;
  title: string;
  contentsConfirmed: boolean;
  /** "$13.75 per pack" on the most recent receipt, or null when never bought. */
  lastPaid: string | null;
  averagePaid: string | null;
  /** Purchases the paid figures are taken from. */
  purchaseCount: number;
  /** Live offers on this pack. */
  offerCount: number;
  /** Any offer at all, rejected ones included: what stops a pack being removed. */
  hasOffers: boolean;
  /** Receipt lines whose cost per unit a change to the pack would restate. */
  lineCount: number;
  innerQuantity: number;
  innerUnitId: string;
  packCount: number;
  label: string | null;
  soldLoose: boolean;
  packaging: string | null;
};

/**
 * An item's pack sizes: what each holds, and what one has cost.
 *
 * These were headings over the offers, with what a pack cost listed a second
 * time in the card above. Now that offers are one table across every pack,
 * the packs get a table of their own, and the per-pack prices sit on the pack
 * they belong to.
 */
export function PackSizesTable({
  itemId,
  canonicalUnitId,
  packs,
  units,
  canEdit,
}: {
  itemId: string;
  canonicalUnitId: string;
  packs: PackRow[];
  units: Unit[];
  canEdit: boolean;
}) {
  // A pack nobody has confirmed the contents of starts open: until somebody
  // says what is in it, every cost per unit worked out from it is provisional.
  const [openId, setOpenId] = useState<string | null>(() =>
    canEdit ? (packs.find((p) => !p.contentsConfirmed)?.id ?? null) : null
  );
  // Open when the item has no pack sizes yet, when adding one is the obvious
  // next step (#42).
  const [adding, setAdding] = useState(canEdit && packs.length === 0);
  const close = useCallback(() => setOpenId(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  const form = (p: PackRow) => (
    <PackSizeForm
      itemId={itemId}
      packSizeId={p.id}
      innerQuantity={p.innerQuantity}
      innerUnitId={p.innerUnitId}
      packCount={p.packCount}
      label={p.label}
      soldLoose={p.soldLoose}
      packaging={p.packaging}
      units={units}
      purchaseCount={p.lineCount}
      canRemove={!p.hasOffers}
      onSaved={close}
      onCancel={close}
    />
  );

  const contents = (p: PackRow) =>
    p.contentsConfirmed ? (
      <span className="badge badge-good">Confirmed</span>
    ) : (
      <span className="badge badge-waiting">Not confirmed</span>
    );

  const action = (p: PackRow) => {
    if (!canEdit) return null;
    const open = openId === p.id;
    const label = p.contentsConfirmed ? "Edit" : "Confirm what's in this pack";
    return (
      <button type="button" onClick={() => toggle(p.id)} aria-expanded={open} className="btn btn-quiet btn-xs">
        {open ? "Close" : label}
      </button>
    );
  };

  const none = <span className="text-ink/45">—</span>;

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="section-title text-ink">Pack sizes</h2>
          <p className="mt-1 text-sm text-ink/50">
            What a pack holds, and what one has cost. The cost per unit is worked out from these.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className="btn btn-secondary">
            + Add pack size
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4 rounded-lg border border-ink/10 bg-cream p-3">
          <p className="mb-2 text-sm font-medium text-ink">New pack size</p>
          <AddPackSizeForm
            itemId={itemId}
            canonicalUnitId={canonicalUnitId}
            units={units}
            onAdded={closeAdd}
            onCancel={closeAdd}
          />
        </div>
      )}

      {packs.length === 0 ? (
        <p className="text-sm text-ink/50">No pack sizes yet.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto xl:block">
            <table className="min-w-full text-body">
              <thead>
                <tr className="border-b border-ink/15 text-left text-support text-ink/70">
                  <th scope="col" className="pr-4 pb-2.5 font-semibold">Pack</th>
                  <th scope="col" className="pr-4 pb-2.5 font-semibold">Contents</th>
                  <th scope="col" className="pr-4 pb-2.5 text-right font-semibold">Last paid</th>
                  <th scope="col" className="pr-4 pb-2.5 text-right font-semibold">Average paid</th>
                  <th scope="col" className="pr-4 pb-2.5 text-right font-semibold">Purchases</th>
                  <th scope="col" className="pr-4 pb-2.5 text-right font-semibold">Offers</th>
                  <th scope="col" className="pb-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => {
                  const open = openId === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className={`align-top ${open ? "bg-gold/[0.09]" : "border-b border-ink/[0.06] last:border-0"}`}>
                        <td className="py-2.5 pr-4 font-medium text-ink">{p.title}</td>
                        <td className="py-2.5 pr-4">{contents(p)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums whitespace-nowrap">{p.lastPaid ?? none}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums whitespace-nowrap">{p.averagePaid ?? none}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{p.purchaseCount || none}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{p.offerCount || none}</td>
                        <td className="py-2.5 text-right whitespace-nowrap">{action(p)}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-ink/10 bg-gold/[0.09]">
                          <td colSpan={7} className="px-3 pb-4">
                            <div className="rounded-lg border border-ink/10 bg-cream p-3">{form(p)}</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 xl:hidden">
            {packs.map((p) => (
              <li key={p.id} className="rounded-md border border-ink/10 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{p.title}</span>
                  {contents(p)}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body">
                  {(
                    [
                      ["Last paid", p.lastPaid ?? none],
                      ["Average paid", p.averagePaid ?? none],
                      ["Purchases", p.purchaseCount || none],
                      ["Offers", p.offerCount || none],
                    ] as const
                  ).map(([label, value]) => (
                    <Fragment key={label}>
                      <dt className="text-support text-ink/55">{label}</dt>
                      <dd className="text-right tabular-nums">{value}</dd>
                    </Fragment>
                  ))}
                </dl>
                <div className="mt-2 flex justify-end">{action(p)}</div>
                {openId === p.id && <div className="mt-3 border-t border-ink/10 pt-3">{form(p)}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
