"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  dismissDuplicatePair,
  mergeItemAction,
  searchItemsForMerge,
  type ItemSearchResult,
  type MergeItemState,
} from "../actions";

const initialState: MergeItemState = { error: null };

export type DuplicateCandidate = {
  id: string;
  itemNumber: string | null;
  name: string;
  categoryLabel: string | null;
  score: number;
};

type Target = { id: string; label: string };

export function MergePanel({
  itemId,
  itemName,
  itemNumber,
  packSizeCount,
  offerCount,
  purchaseCount,
  candidates,
}: {
  itemId: string;
  itemName: string;
  itemNumber: string | null;
  packSizeCount: number;
  offerCount: number;
  purchaseCount: number;
  candidates: DuplicateCandidate[];
}) {
  const [state, formAction, pending] = useActionState(mergeItemAction, initialState);
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

  if (candidates.length === 0 && !target && query.trim().length === 0) {
    return (
      <details>
        <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">
          Merge this item into another
        </summary>
        <div className="mt-3">
          <SearchBox query={query} setQuery={setQuery} results={results} searching={searching} onPick={setTarget} />
        </div>
      </details>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {candidates.length > 0 && !target && (
        <div>
          <p className="mb-2 text-sm text-ink/70">
            These look like they might be the same product. Merging keeps all purchase history.
          </p>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-mono text-xs text-ink/50">{c.itemNumber ?? "—"}</span>{" "}
                  <span className="text-ink">{c.name}</span>
                  {c.categoryLabel && <span className="ml-1 text-xs text-ink/40">({c.categoryLabel})</span>}
                  <span className="ml-2 text-xs text-ink/40">{Math.round(c.score * 100)}% similar</span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTarget({ id: c.id, label: `${c.itemNumber ?? ""} ${c.name}`.trim() })}
                    className="rounded-md border border-ink/15 px-3 py-1 text-xs hover:border-ink/30"
                  >
                    Merge into this
                  </button>
                  <form action={dismissDuplicatePair}>
                    <input type="hidden" name="item_a" value={itemId} />
                    <input type="hidden" name="item_b" value={c.id} />
                    <button type="submit" className="text-xs text-ink/50 hover:text-ink hover:underline">
                      Not a duplicate
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!target && (
        <details open={candidates.length === 0}>
          <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">Merge into a different item</summary>
          <div className="mt-3">
            <SearchBox query={query} setQuery={setQuery} results={results} searching={searching} onPick={setTarget} />
          </div>
        </details>
      )}

      {target && (
        <form action={formAction} className="rounded-md border border-maroon/30 bg-maroon/5 p-4">
          <input type="hidden" name="loser_id" value={itemId} />
          <input type="hidden" name="winner_id" value={target.id} />
          <p className="text-sm text-ink">
            Merge <strong>{itemNumber ? `${itemNumber} — ` : ""}{itemName}</strong> into{" "}
            <strong>{target.label}</strong>?
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink/70">
            <li>
              {packSizeCount} pack size(s) and {offerCount} vendor offer(s) move across
            </li>
            <li>
              {purchaseCount > 0
                ? `${purchaseCount} recorded purchase(s) stay attached and keep counting towards cost per unit`
                : "no purchases are recorded against this item yet"}
            </li>
            <li>
              <strong>
                {itemNumber ? `${itemNumber} — ` : ""}
                {itemName}
              </strong>{" "}
              is then deleted. This can&apos;t be undone.
            </li>
          </ul>
          <div className="mt-3 flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-cream hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Merging…" : "Merge and delete"}
            </button>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30"
            >
              Cancel
            </button>
          </div>
          {state.error && <p className="mt-2 text-sm text-maroon">{state.error}</p>}
        </form>
      )}
    </div>
  );
}

function SearchBox({
  query,
  setQuery,
  results,
  searching,
  onPick,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: ItemSearchResult[];
  searching: boolean;
  onPick: (t: Target) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by item name or number…"
        className="input w-full max-w-md"
      />
      {searching && <p className="text-xs text-ink/40">Searching…</p>}
      {!searching && results.length > 0 && (
        <ul className="flex max-w-md flex-col gap-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick({ id: r.id, label: `${r.itemNumber ?? ""} ${r.name}`.trim() })}
                className="flex w-full flex-col items-start rounded-md border border-ink/10 px-3 py-2 text-left text-sm hover:border-ink/30"
              >
                <span className="text-ink">
                  <span className="font-mono text-xs text-ink/50">{r.itemNumber ?? "—"}</span> {r.name}
                </span>
                <span className="text-xs text-ink/40">
                  {r.categoryLabel ?? "no category"} · {r.packSizeCount} pack size(s)
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-ink/40">No matching items.</p>
      )}
    </div>
  );
}
