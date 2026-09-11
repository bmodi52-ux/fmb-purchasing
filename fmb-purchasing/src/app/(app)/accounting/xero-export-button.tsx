"use client";

import { useState } from "react";
import { exportXeroBills } from "./actions";
import type { Basis } from "@/lib/accounting-data";

export function XeroExportButton({ period, basis }: { period: string; basis: Basis }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportXeroBills(period, basis);
      const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        result.missingAccountCodes > 0
          ? { text: `${result.rows} lines saved. ${result.missingAccountCodes} have no account code, and Xero will refuse them — set the codes below and download again.`, warn: true }
          : { text: `${result.rows} lines saved. When Xero asks, choose "Tax inclusive".`, warn: false }
      );
    } catch {
      setMessage({ text: "The file couldn't be made. Try again.", warn: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="self-start rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
      >
        {busy ? "Making the file…" : "Download Xero bills file"}
      </button>
      {message && <p className={`text-xs ${message.warn ? "text-maroon" : "text-ink/60"}`}>{message.text}</p>}
    </div>
  );
}
