"use client";

import { useEffect, useRef, useState } from "react";
import { exportWidgetsPdf } from "@/lib/export";
import { usePrintRegistry } from "./printable";

/**
 * What to print, and the button that prints it: the whole page or chosen
 * parts of it, as a PDF picture with the charts in.
 *
 * Opened from the Download menu (spending-actions), where the other ways of
 * taking a report away are; it has no button of its own. It is there only
 * while it is open, so every part starts ticked each time — switching section
 * or filters between one print and the next never leaves a stale choice
 * silently narrowing what is printed.
 */
export function PrintPanel({
  title,
  subtitle,
  filenameBase,
  onClose,
}: {
  title: string;
  subtitle: string;
  filenameBase: string;
  onClose: () => void;
}) {
  const { entries } = usePrintRegistry();
  const [mode, setMode] = useState<"whole" | "select">("whole");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.id)));
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDownload() {
    const chosen = mode === "whole" ? entries : entries.filter((e) => selected.has(e.id));
    if (chosen.length === 0) return;

    setBusy(true);
    try {
      const widgets = chosen
        .map((e) => ({ label: e.label, element: e.ref.current }))
        .filter((w): w is { label: string; element: HTMLDivElement } => w.element != null);
      await exportWidgetsPdf(`${filenameBase}.pdf`, title, subtitle, widgets);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const nothingChosen = entries.length === 0 || (mode === "select" && selected.size === 0);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Print"
      className="absolute top-full left-0 z-30 mt-1 flex w-72 flex-col rounded-lg border border-ink/15 bg-white shadow-lg sm:right-0 sm:left-auto"
    >
      <div className="flex flex-col gap-2 border-b border-ink/10 p-3">
        <p className="text-support text-ink/70">A PDF picture of the page, charts and all.</p>
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="radio" checked={mode === "whole"} onChange={() => setMode("whole")} />
          Whole page
        </label>
        <label className="flex items-center gap-2 text-body text-ink">
          <input type="radio" checked={mode === "select"} onChange={() => setMode("select")} />
          Select widgets
        </label>
      </div>

      {mode === "select" && (
        <div className="max-h-64 overflow-y-auto p-1">
          {entries.map((e) => (
            <label key={e.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-body hover:bg-gold/10">
              <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{e.label}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-3 py-2">
        <span className="text-support text-ink/70">
          {entries.length === 0
            ? "Nothing here to print"
            : mode === "whole"
              ? `${entries.length} widget${entries.length === 1 ? "" : "s"}`
              : `${selected.size} of ${entries.length}`}
        </span>
        <button type="button" onClick={handleDownload} disabled={busy || nothingChosen} className="btn btn-primary btn-sm">
          {busy ? "Generating…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}
