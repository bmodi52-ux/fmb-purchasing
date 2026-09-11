"use client";

import { useEffect, useRef, useState } from "react";
import { getExpenseAttachments, type SignedAttachment } from "@/lib/receipts";
import { PdfPages } from "./pdf-pages";

/**
 * The files behind one expense.
 *
 * Plural since migration 0028: a submission is routinely a receipt plus a
 * delivery docket, or a two-page invoice photographed twice because it would
 * not fit in one frame. When there is only one — still the common case — the
 * tab strip is not rendered at all.
 *
 * URLs are signed on demand, when the dialog opens, rather than for every row
 * of a list that mostly will not be opened.
 */
export function ReceiptViewer({ expenseId, label = "View receipt" }: { expenseId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<SignedAttachment[] | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  async function handleOpen() {
    setOpen(true);
    if (files) return;
    setLoading(true);
    setFailed(false);
    try {
      const found = await getExpenseAttachments(expenseId);
      if (found.length === 0) setFailed(true);
      else setFiles(found);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
    // Send focus back where it came from, or a keyboard user is dropped at the
    // top of the document with no idea what just happened.
    openerRef.current?.focus();
  }

  // Escape closes, and Tab is kept inside the dialog while it is open —
  // otherwise the focus ring walks straight out into the page behind it.
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    // Focus lands inside on open, so the first Tab stays in the dialog.
    dialogRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = files?.[active] ?? null;
  const isPdf = current ? /pdf/i.test(current.contentType) || /\.pdf(\?|$)/i.test(current.url) : false;
  // A saved email has no rendering here — it would fall through to <img> and
  // show a broken-image icon, which reads as a lost receipt rather than as a
  // file this viewer cannot draw.
  const isEmailFile = current
    ? /rfc822/i.test(current.contentType) || /\.eml(\?|$)/i.test(current.url)
    : false;
  const headingId = `receipt-title-${expenseId}`;

  return (
    <>
      <button ref={openerRef} type="button" onClick={handleOpen} className="text-ink underline">
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-cream shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-2">
              <span id={headingId} className="section-title text-ink">
                {files && files.length > 1 ? `Attachments (${files.length})` : "Receipt"}
              </span>
              <div className="flex items-center gap-3">
                {current && (
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-ink/60 underline"
                  >
                    Open in new tab
                  </a>
                )}
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="-m-2 p-2 text-xl leading-none text-ink/60 hover:text-ink"
                >
                  ×
                </button>
              </div>
            </div>

            {files && files.length > 1 && (
              <div className="flex gap-1 overflow-x-auto border-b border-ink/10 px-3 py-1.5">
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

            <div className="overflow-auto bg-ink/5">
              {loading && <p className="p-6 text-sm text-ink/50">Loading…</p>}
              {failed && <p className="p-6 text-sm text-maroon/70">Couldn&apos;t load this receipt.</p>}
              {current &&
                (isEmailFile ? (
                  <div className="flex flex-col items-start gap-2 p-6 text-sm">
                    <p className="text-ink/70">
                      This receipt was submitted as a saved email. Its message and any
                      attachments were read when it was uploaded.
                    </p>
                    <a href={current.url} download={current.fileName} className="text-ink underline">
                      Download {current.fileName}
                    </a>
                  </div>
                ) : isPdf ? (
                  <PdfPages url={current.url} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.url} alt={current.fileName} className="h-auto w-full" />
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
