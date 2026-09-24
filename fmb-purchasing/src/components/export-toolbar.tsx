"use client";

import { useEffect, useRef, useState } from "react";
import { exportCsv, exportExcel, exportPdf, exportJson, type ExportColumn } from "@/lib/export";

type Format = "csv" | "excel" | "pdf" | "json";

const FORMATS: { format: Format; label: string; hint: string }[] = [
  { format: "excel", label: "Excel", hint: ".xlsx" },
  { format: "csv", label: "CSV", hint: "for other spreadsheets" },
  { format: "pdf", label: "PDF", hint: "to print or send" },
  { format: "json", label: "JSON", hint: "for other software" },
];

/**
 * The row count and one Export menu (#26). Four format buttons sat above every
 * table — twice on the Pricelist and Vendors pages — for something done now
 * and then; one menu says the same with a quarter of the noise.
 */
export function ExportToolbar({
  filenameBase,
  title,
  columns,
  rows,
}: {
  filenameBase: string;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function handle(format: Format) {
    setOpen(false);
    setBusy(format);
    try {
      if (format === "csv") exportCsv(`${filenameBase}.csv`, columns, rows);
      else if (format === "json") exportJson(`${filenameBase}.json`, columns, rows);
      else if (format === "excel") await exportExcel(`${filenameBase}.xlsx`, title, columns, rows);
      else await exportPdf(`${filenameBase}.pdf`, title, columns, rows);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink/50">
        {rows.length} row{rows.length === 1 ? "" : "s"}
      </span>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy !== null}
          aria-expanded={open}
          aria-haspopup="menu"
          className="btn btn-secondary btn-xs"
        >
          {busy ? "Exporting…" : "Export ▾"}
        </button>
        {open && (
          <ul
            role="menu"
            className="absolute top-full right-0 z-20 mt-1 w-52 rounded-md border border-ink/15 bg-white p-1 text-sm shadow-md"
          >
            {FORMATS.map((f) => (
              <li key={f.format} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handle(f.format)}
                  className="flex w-full items-baseline justify-between gap-3 rounded px-2.5 py-1.5 text-left hover:bg-gold/10"
                >
                  <span className="text-ink">{f.label}</span>
                  <span className="text-xs text-ink/45">{f.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
