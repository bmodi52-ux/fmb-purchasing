"use client";

import { useEffect, useState } from "react";
import { getExpenseAttachments, type SignedAttachment } from "@/lib/receipts";
import { ReceiptFileBody } from "./receipt-viewer";

/**
 * An expense's receipt drawn in place, beside the lines it has to agree with.
 *
 * Reviewing meant opening the receipt in a popup that covered the line items,
 * then closing it to compare — the two things being checked against each
 * other were never on screen together. Loads when shown, so a list only signs
 * URLs for the receipts somebody actually opens. Key it by expense so moving
 * to another expense starts clean.
 */
export function ReceiptInline({ expenseId, className = "" }: { expenseId: string; className?: string }) {
  const [files, setFiles] = useState<SignedAttachment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getExpenseAttachments(expenseId)
      .then((found) => {
        if (cancelled) return;
        setFiles(found);
        setFailed(found.length === 0);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  const current = files?.[active] ?? null;

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-ink/10 bg-ink/5 ${className}`}>
      {files && files.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-ink/10 bg-white/60 px-2 py-1.5">
          {files.map((f, i) => (
            <button
              key={f.url}
              type="button"
              onClick={() => setActive(i)}
              aria-current={i === active ? "true" : undefined}
              className={`shrink-0 rounded px-2.5 py-1 text-xs ${
                i === active ? "bg-gold/25 text-ink" : "text-ink/55 hover:bg-gold/10"
              }`}
            >
              {f.fileName}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!files && !failed && <p className="p-4 text-sm text-ink/50">Loading receipt…</p>}
        {failed && <p className="p-4 text-sm text-ink/50">Couldn&apos;t load this receipt.</p>}
        {current && <ReceiptFileBody file={current} />}
      </div>

      {current && (
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          className="border-t border-ink/10 bg-white/60 px-3 py-1.5 text-xs text-ink/60 underline"
        >
          Open in new tab
        </a>
      )}
    </div>
  );
}
