"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  mergeVendorAction,
  searchVendorsForMerge,
  undoVendorMergeAction,
  type VendorMergeState,
  type VendorSearchResult,
} from "./merge-actions";

const initialState: VendorMergeState = { error: null };

/**
 * "Merge into…" on a duplicate vendor's page (#44): pick the vendor to keep,
 * see what happens, confirm. Shaped like the item merge on the Pricelist.
 */
export function VendorMergePanel({
  vendorId,
  vendorLabel,
  createdAt,
  expenseCount,
  offerCount,
}: {
  vendorId: string;
  vendorLabel: string;
  createdAt: string;
  expenseCount: number;
  offerCount: number;
}) {
  const [state, formAction, pending] = useActionState(mergeVendorAction, initialState);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VendorSearchResult[]>([]);
  const [target, setTarget] = useState<(VendorSearchResult & { createdAt?: string }) | null>(null);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => setResults(await searchVendorsForMerge(query, vendorId)));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, vendorId]);

  const targetLabel = target ? `${target.vendorNumber ?? ""} ${target.name}`.trim() : "";

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">Merge this vendor into another…</summary>
      <div className="mt-3 flex flex-col gap-3">
        {!target && (
          <>
            <p className="text-sm text-ink/60">
              For a duplicate: everything recorded against either vendor ends up on one. It can be undone.
            </p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by vendor name, number or ABN…"
              className="input w-full max-w-md"
            />
            {searching && <p className="text-xs text-ink/40">Searching…</p>}
            {!searching && results.length > 0 && (
              <ul className="flex max-w-md flex-col gap-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setTarget(r)}
                      className="flex w-full flex-col items-start rounded-md border border-ink/10 px-3 py-2 text-left text-sm hover:border-ink/30"
                    >
                      <span className="text-ink">
                        <span className="tabular-nums text-xs text-ink/50">{r.vendorNumber ?? "—"}</span> {r.name}
                      </span>
                      {r.abn && <span className="text-xs text-ink/40">ABN {r.abn}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {target && (
          <form action={formAction} className="rounded-md border border-danger/30 bg-danger/5 p-4">
            <input type="hidden" name="from_id" value={vendorId} />
            <input type="hidden" name="into_id" value={target.id} />
            <p className="text-sm text-ink">
              Merge <strong>{vendorLabel}</strong> into <strong>{targetLabel}</strong>?
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink/70">
              <li>
                {expenseCount} expense{expenseCount === 1 ? "" : "s"} and {offerCount} product offer
                {offerCount === 1 ? "" : "s"} from this vendor, and its contacts, addresses and payee, join{" "}
                {target.name}&apos;s.
              </li>
              <li>
                The same product sold by both becomes one offer, keeping {target.name}&apos;s price; its purchases
                come with it.
              </li>
              <li>
                {target.name}&apos;s name and details are kept. Whichever of the two vendors was created first keeps
                its number, because that&apos;s the number already on paper (this one was created{" "}
                {new Date(createdAt).toLocaleDateString("en-AU")}).
              </li>
              <li>It can be undone later, unless a new expense is filed against an offer the merge combined.</li>
            </ul>
            <div className="mt-3 flex gap-3">
              <SubmitButton
                disabled={pending}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-cream hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Merging…" : "Merge"}
              </SubmitButton>
              <button type="button" onClick={() => setTarget(null)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
            {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
          </form>
        )}
      </div>
    </details>
  );
}

/** Undo one merge (#44); says why when it can't be. */
export function UndoVendorMerge({ mergeId, label }: { mergeId: string; label: string }) {
  const [state, formAction, pending] = useActionState(undoVendorMergeAction, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="merge_id" value={mergeId} />
      <span className="text-ink/70">{label}</span>
      <SubmitButton disabled={pending} className="btn btn-secondary btn-xs">
        {pending ? "Undoing…" : "Undo merge"}
      </SubmitButton>
      {state.error && <span className="basis-full text-danger">{state.error}</span>}
    </form>
  );
}
