"use client";

import { SubmitButton } from "@/components/submit-button";
import { useActionState, useEffect, useState, useTransition } from "react";
import { moveOfferAction, searchItemsForMerge, type ItemSearchResult, type MoveOfferState } from "../actions";
import { SearchBox, type Target } from "./merge-panel";

const initialState: MoveOfferState = { error: null };

/**
 * "This is on the wrong item" (#81): pick the right one, and the offer moves
 * there with its purchases and the vendor's wording.
 */
export function MoveOfferPanel({
  offerId,
  itemId,
  offerLabel,
  purchaseCount,
}: {
  offerId: string;
  itemId: string;
  offerLabel: string;
  purchaseCount: number;
}) {
  const [state, formAction, pending] = useActionState(moveOfferAction, initialState);
  const [target, setTarget] = useState<Target | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => setResults(await searchItemsForMerge(query, itemId)));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, itemId]);

  return (
    <details>
      <summary className="cursor-pointer hover:text-ink">Wrong item? Move it</summary>
      <div className="mt-2 flex flex-col gap-3">
        {!target ? (
          <SearchBox query={query} setQuery={setQuery} results={results} searching={searching} onPick={setTarget} />
        ) : (
          <form action={formAction} className="rounded-md border border-gold/40 bg-gold/5 p-3 text-sm">
            <input type="hidden" name="offer_id" value={offerId} />
            <input type="hidden" name="item_id" value={itemId} />
            <input type="hidden" name="target_item_id" value={target.id} />
            <p className="text-ink">
              Move <strong>{offerLabel}</strong> to <strong>{target.label}</strong>?
            </p>
            <ul className="mt-2 list-disc pl-5 text-ink/70">
              <li>
                {purchaseCount > 0
                  ? `${purchaseCount} recorded purchase${purchaseCount === 1 ? "" : "s"} move with it, and the costs on both items recalculate`
                  : "no purchases are recorded against it yet"}
              </li>
              <li>it goes onto the same pack size there, which is added if that item doesn&apos;t have it</li>
              <li>this vendor&apos;s wording moves too, so their next receipt lands on the right item</li>
            </ul>
            <div className="mt-3 flex gap-3">
              <SubmitButton
                disabled={pending}
                className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep disabled:opacity-50"
              >
                {pending ? "Moving…" : "Move offer"}
              </SubmitButton>
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30"
              >
                Cancel
              </button>
            </div>
            {state.error && <p className="mt-2 text-maroon">{state.error}</p>}
          </form>
        )}
      </div>
    </details>
  );
}
