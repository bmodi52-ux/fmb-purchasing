"use client";

import { useState } from "react";
import { formatPlainDate } from "@/lib/format";
import { confirmBankMatches, matchBankStatement, type ReconcileResult } from "./actions";

const money = (cents: number) => (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * Upload a statement, check the pairs, confirm (#37).
 *
 * Nothing is recorded until Confirm: the matching is a suggestion a person
 * reads, and any pair can be unticked first.
 */
export function ReconcileForm() {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function read(file: File) {
    setBusy(true);
    setDone(null);
    try {
      const matched = await matchBankStatement(await file.text());
      setResult(matched);
      setChosen(new Set(matched.ok ? matched.matches.map((m) => m.key) : []));
    } catch {
      setResult({ ok: false, message: "The statement couldn't be read. Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result?.ok) return;
    setBusy(true);
    try {
      const { confirmed } = await confirmBankMatches(
        result.matches.filter((m) => chosen.has(m.key)).map((m) => ({ key: m.key, statementDate: m.statementDate, statementText: m.statementText }))
      );
      setDone(`${confirmed} paid ${confirmed === 1 ? "expense is" : "expenses are"} now confirmed on the bank statement.`);
      setResult(null);
    } catch {
      setDone("The matches couldn't be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex w-fit cursor-pointer flex-col gap-1 rounded-lg border border-dashed border-ink/25 bg-white/60 px-5 py-4 text-sm hover:border-ink/40">
        <span className="font-medium text-ink">{busy ? "Reading…" : "Choose a statement CSV"}</span>
        <span className="text-xs text-ink/55">Exported from internet banking — CommBank, NAB, Westpac and ANZ layouts all work.</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read(file);
            e.target.value = "";
          }}
        />
      </label>

      {done && <p className="rounded-md bg-palm/10 px-3 py-2 text-sm text-ink/80">{done}</p>}
      {result && !result.ok && <p className="rounded-md bg-maroon/5 px-3 py-2 text-sm text-maroon">{result.message}</p>}

      {result?.ok && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="section-title text-ink">Found on the statement ({result.matches.length})</h2>
            {result.matches.length === 0 ? (
              <p className="text-sm text-ink/55">None of the payments recorded as made appear in this statement.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs text-ink/55">
                    <tr>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">Confirm</span></th>
                      <th scope="col" className="px-3 py-2 font-medium">Paid to</th>
                      <th scope="col" className="px-3 py-2 font-medium">Recorded</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2 font-medium">On the statement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.map((m) => (
                      <tr key={m.key} className="border-t border-ink/5">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={chosen.has(m.key)}
                            aria-label={`Confirm ${m.payeeName}`}
                            onChange={() =>
                              setChosen((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.key)) next.delete(m.key);
                                else next.add(m.key);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">{m.payeeName}</td>
                        <td className="px-3 py-2 text-ink/70">
                          {formatPlainDate(m.paymentDate)}
                          {m.reference ? ` · ${m.reference}` : ""}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{money(m.amountCents)}</td>
                        <td className="px-3 py-2 text-ink/70">
                          {formatPlainDate(m.statementDate)} · {m.statementText}
                          {m.byReference && <span className="ml-2 rounded-full bg-palm/15 px-2 py-0.5 text-xs text-palm">reference matches</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.matches.length > 0 && (
              <button
                type="button"
                onClick={confirm}
                disabled={busy || chosen.size === 0}
                className="self-start rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep disabled:opacity-50"
              >
                Confirm {chosen.size} {chosen.size === 1 ? "payment" : "payments"}
              </button>
            )}
          </section>

          {result.unmatchedPayments.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="section-title text-maroon">Recorded as paid, but not on this statement ({result.unmatchedPayments.length})</h2>
              <p className="text-xs text-ink/55">Worth a look: a transfer that was never sent, or one sent for a different amount.</p>
              <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-maroon/20 bg-white/60 text-sm">
                {result.unmatchedPayments.map((p) => (
                  <li key={p.key} className="flex justify-between gap-3 px-3 py-2">
                    <span>
                      {p.payeeName} · {formatPlainDate(p.paymentDate)}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    <span className="font-mono">{money(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-ink/50">
            {result.unmatchedLines.length} other {result.unmatchedLines.length === 1 ? "payment" : "payments"} out on the statement
            {result.skippedRows > 0 ? `, and ${result.skippedRows} rows that couldn't be read,` : ""} weren&apos;t matched to anything recorded
            here.
          </p>
        </>
      )}
    </div>
  );
}
