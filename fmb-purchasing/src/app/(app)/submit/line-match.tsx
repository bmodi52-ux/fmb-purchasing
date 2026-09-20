"use client";

import { PackFields, type PackFieldValues } from "../pricelist/pack-fields";
import type { LineMatchResult } from "./actions";

export type PackUnit = { id: string; code: string; label: string };

/** The pack dropdown's value for "one this item doesn't have yet" (#60). */
const NEW_PACK = "__new__";

/**
 * What a goods line will be filed against, shown under the line itself.
 *
 * Matching used to happen out of sight at submission: the form never said
 * which Pricelist item a line had found, so a line that found nothing simply
 * became a new item, and the first anyone knew was a duplicate on the
 * Pricelist. Now every line says what it is before anything is saved — and
 * where the app is not sure, it asks the person holding the invoice.
 */
export function LineMatchRow({
  description,
  match,
  onConfirm,
  onReject,
  onChoosePack,
  onChooseItem,
  units,
  newPack,
  onNewPack,
  onNewPackChange,
  layout = "row",
}: {
  description: string;
  match: LineMatchResult | null | undefined;
  onConfirm: () => void;
  onReject: () => void;
  onChoosePack: (packSizeId: string | null) => void;
  onChooseItem: (itemId: string) => void;
  units: PackUnit[];
  /** The pack being described because the item has no such pack (#60). */
  newPack: PackFieldValues | null;
  onNewPack: (on: boolean) => void;
  onNewPackChange: (values: PackFieldValues) => void;
  /** "row" under a table row; "stack" inside the card a phone shows instead. */
  layout?: "row" | "stack";
}) {
  if (!description.trim()) return null;

  const summary = (
    <MatchSummary
      match={match}
      onConfirm={onConfirm}
      onReject={onReject}
      onChoosePack={onChoosePack}
      onChooseItem={onChooseItem}
      units={units}
      newPack={newPack}
      onNewPack={onNewPack}
      onNewPackChange={onNewPackChange}
    />
  );

  if (layout === "stack") return <div className="text-xs">{summary}</div>;

  return (
    <tr>
      <td />
      <td colSpan={10} className="px-1 pb-2 text-xs">
        {summary}
      </td>
    </tr>
  );
}

function MatchSummary({
  match,
  onConfirm,
  onReject,
  onChoosePack,
  onChooseItem,
  units,
  newPack,
  onNewPack,
  onNewPackChange,
}: {
  match: LineMatchResult | null | undefined;
  onConfirm: () => void;
  onReject: () => void;
  onChoosePack: (packSizeId: string | null) => void;
  onChooseItem: (itemId: string) => void;
  units: PackUnit[];
  newPack: PackFieldValues | null;
  onNewPack: (on: boolean) => void;
  onNewPackChange: (values: PackFieldValues) => void;
}) {
  if (match === undefined) {
    return <span className="text-ink/40">Looking for this on the Pricelist…</span>;
  }

  if (match === null) {
    return (
      <span className="text-ink/45">
        Not linked to the Pricelist yet — pick an item from the suggestions, or it will be added as a new item.
      </span>
    );
  }

  if (!match.itemId) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ink/60">
          <span className="font-medium text-gold-deep">New item:</span> not on the Pricelist, so it will be added
          when you submit.
        </span>
        {match.alternatives.length > 0 && (
          <>
            <span className="text-ink/50">Or is it</span>
            {match.alternatives.map((a) => (
              <button
                key={a.itemId}
                type="button"
                onClick={() => onChooseItem(a.itemId)}
                className="rounded border border-ink/15 bg-white px-2 py-0.5 text-ink hover:border-ink/40"
              >
                {a.itemName}
                {a.itemNumber && <span className="ml-1 font-mono text-ink/40">{a.itemNumber}</span>}
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  const sure = match.confidence === "sure";
  const needsPack = match.packs.length > 1 && !match.packSizeId && !newPack;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`font-medium ${sure ? "text-palm" : "text-gold-deep"}`}>{sure ? "✓ Pricelist:" : "Check:"}</span>
      <span className="text-ink">{match.itemName}</span>
      {match.itemNumber && <span className="font-mono text-ink/45">{match.itemNumber}</span>}

      {/* A dropdown even when the item has one pack: the pack it has may not
          be the one on this line, and that used to be filed silently against
          it — eight 3 kg bags recorded as the 10 kg box (#60). */}
      {match.packs.length > 0 ? (
        <select
          value={newPack ? NEW_PACK : (match.packSizeId ?? "")}
          onChange={(e) => {
            if (e.target.value === NEW_PACK) onNewPack(true);
            else {
              onNewPack(false);
              onChoosePack(e.target.value || null);
            }
          }}
          aria-label={`Which pack of ${match.itemName}`}
          className={`rounded border bg-white px-1.5 py-0.5 ${needsPack ? "border-maroon/50" : "border-ink/15"}`}
        >
          {match.packs.length > 1 && <option value="">— which pack? —</option>}
          {match.packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
          <option value={NEW_PACK}>+ a pack size this item doesn&apos;t have yet</option>
        </select>
      ) : (
        <span className="text-ink/50">· no pack sizes yet, one will be added</span>
      )}

      {needsPack && <span className="text-maroon">Choose the pack before submitting</span>}

      {newPack && (
        <div className="mt-1 w-full rounded-md border border-gold/40 bg-gold/5 p-2">
          <p className="mb-2 text-ink/70">
            A pack size {match.itemName} doesn&apos;t have yet. It is added to the Pricelist, for review, when you
            submit.
          </p>
          <PackFields units={units} defaults={newPack} onChange={onNewPackChange} />
        </div>
      )}

      {sure ? (
        <button type="button" onClick={onReject} className="text-ink/45 underline hover:text-ink">
          Not this
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded border border-palm/40 bg-white px-2 py-0.5 text-palm hover:border-palm"
          >
            Yes, that&apos;s it
          </button>
          <button type="button" onClick={onReject} className="text-ink/45 underline hover:text-ink">
            No
          </button>
        </>
      )}
    </div>
  );
}
