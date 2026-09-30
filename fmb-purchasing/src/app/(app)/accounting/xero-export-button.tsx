"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { exportXeroBills } from "./actions";
import type { Basis } from "@/lib/accounting-data";

/**
 * Downloads the Xero bills file, and records it (0087). When an earlier file
 * held some of this period's bills, the new one leaves them out unless asked
 * not to — importing a bill twice makes two bills in Xero.
 */
export function XeroExportButton({
  period,
  basis,
  sentBefore,
  fresh,
}: {
  period: string;
  basis: Basis;
  /** Bills in this period an earlier file held. */
  sentBefore: number;
  /** Bills in this period no earlier file held. */
  fresh: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newOnly, setNewOnly] = useState(sentBefore > 0);
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);

  const nothingNew = newOnly && fresh === 0;

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportXeroBills(period, basis, newOnly);
      if (result.rows === 0) {
        setMessage({ text: "No bills to put in a file.", warn: false });
        return;
      }
      const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      const parts = [`${result.bills} ${result.bills === 1 ? "bill" : "bills"}, ${result.rows} lines saved.`];
      if (result.leftOut > 0) parts.push(`${result.leftOut} already sent in an earlier file ${result.leftOut === 1 ? "was" : "were"} left out.`);
      if (result.sentBefore > 0) parts.push(`${result.sentBefore} ${result.sentBefore === 1 ? "was" : "were"} in an earlier file too — don't import ${result.sentBefore === 1 ? "it" : "them"} twice.`);
      if (result.missingAccountCodes > 0) {
        parts.push(`${result.missingAccountCodes} lines have no account code, and Xero will refuse them — set the codes below and download again.`);
      } else {
        parts.push(`When Xero asks, choose "Tax inclusive".`);
      }
      setMessage({ text: parts.join(" "), warn: result.missingAccountCodes > 0 || result.sentBefore > 0 });
      // The page lists the files downloaded; this one is now among them.
      router.refresh();
    } catch (e) {
      setMessage({ text: e instanceof Error && e.message ? e.message : "The file couldn't be made. Try again.", warn: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {sentBefore > 0 && (
        <label className="flex items-center gap-2 text-xs text-ink/70">
          <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
          Leave out the {sentBefore} {sentBefore === 1 ? "bill" : "bills"} already in an earlier file
        </label>
      )}
      <button type="button" onClick={download} disabled={busy || nothingNew} className="btn btn-primary self-start">
        {busy ? "Making the file…" : nothingNew ? "Every bill here has been sent" : "Download Xero bills file"}
      </button>
      {message && <p className={`text-xs ${message.warn ? "text-danger" : "text-ink/60"}`}>{message.text}</p>}
    </div>
  );
}
