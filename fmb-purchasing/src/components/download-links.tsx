"use client";

import { useEffect, useRef, useState } from "react";

const FORMATS = [
  { format: "xlsx", name: "Excel", says: "Every table, each on its own sheet" },
  { format: "csv", name: "CSV", says: "The main table" },
  { format: "pdf", name: "PDF", says: "The tables as text, to share or print" },
] as const;

/**
 * Excel, CSV and PDF downloads of a report (reports/export), behind one
 * button. `href` is the export URL without a format; each choice adds its
 * own. The choices are plain links, so the browser shows its own progress
 * and a download needs nothing from this page but the address.
 *
 * One button rather than a row of three: beside a report's name there is
 * room for what the report is, and the formats only matter once someone has
 * decided to take it away.
 */
export function DownloadLinks({ href, label, children }: { href: string; label?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sep = href.includes("?") ? "&" : "?";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="btn btn-secondary btn-sm"
      >
        {label ? `Download ${label}` : "Download"}
        <span aria-hidden="true" className="text-ink/50">
          ▾
        </span>
      </button>

      {open && (
        // Opens towards whichever side has the room: the button sits at the
        // right of a wide page and at the left once its row has wrapped.
        <div className="absolute top-full left-0 z-30 mt-1 flex w-64 flex-col rounded-lg border border-ink/15 bg-white p-1 shadow-lg sm:right-0 sm:left-auto">
          {FORMATS.map((f) => (
            <a
              key={f.format}
              href={`${href}${sep}format=${f.format}`}
              download
              onClick={() => setOpen(false)}
              className="rounded px-3 py-2 hover:bg-gold/10"
            >
              <span className="block text-body font-medium text-ink">{f.name}</span>
              <span className="block text-support text-ink/70">{f.says}</span>
            </a>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
