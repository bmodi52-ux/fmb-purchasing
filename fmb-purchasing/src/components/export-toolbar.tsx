"use client";

import { useState } from "react";
import { exportCsv, exportExcel, exportPdf, exportJson, type ExportColumn } from "@/lib/export";

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
  const [busy, setBusy] = useState<string | null>(null);

  async function handle(format: "csv" | "excel" | "pdf" | "json") {
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

  const btnClass =
    "rounded-md border border-ink/15 px-2 py-1 text-xs text-ink/70 hover:border-ink/30 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink/50">
        {rows.length} row{rows.length === 1 ? "" : "s"}
      </span>
      <button type="button" onClick={() => handle("csv")} disabled={busy !== null} className={btnClass}>
        {busy === "csv" ? "…" : "CSV"}
      </button>
      <button type="button" onClick={() => handle("excel")} disabled={busy !== null} className={btnClass}>
        {busy === "excel" ? "…" : "Excel"}
      </button>
      <button type="button" onClick={() => handle("pdf")} disabled={busy !== null} className={btnClass}>
        {busy === "pdf" ? "…" : "PDF"}
      </button>
      <button type="button" onClick={() => handle("json")} disabled={busy !== null} className={btnClass}>
        {busy === "json" ? "…" : "JSON"}
      </button>
    </div>
  );
}
