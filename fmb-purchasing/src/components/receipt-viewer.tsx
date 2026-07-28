"use client";

import { useEffect, useState } from "react";
import { getExpenseReceiptUrl } from "@/lib/receipts";
import { PdfPages } from "./pdf-pages";

export function ReceiptViewer({ expenseId, label = "View receipt" }: { expenseId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleOpen() {
    setOpen(true);
    if (url) return;
    setLoading(true);
    setFailed(false);
    const signedUrl = await getExpenseReceiptUrl(expenseId);
    setLoading(false);
    if (signedUrl) setUrl(signedUrl);
    else setFailed(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isPdf = url ? /\.pdf(\?|$)/i.test(url) : false;

  return (
    <>
      <button type="button" onClick={handleOpen} className="text-ink underline">
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-cream shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2">
              <span className="section-title text-ink">Receipt</span>
              <div className="flex items-center gap-3">
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-ink/60 underline">
                    Open in new tab
                  </a>
                )}
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-ink/60 hover:text-ink">
                  ×
                </button>
              </div>
            </div>
            <div className="overflow-auto bg-ink/5">
              {loading && <p className="p-6 text-sm text-ink/50">Loading…</p>}
              {failed && <p className="p-6 text-sm text-maroon/70">Couldn&apos;t load this receipt.</p>}
              {url &&
                (isPdf ? (
                  <PdfPages url={url} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="Receipt" className="h-auto w-full" />
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
