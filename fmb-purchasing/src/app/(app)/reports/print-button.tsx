"use client";

import { useEffect, useRef, useState } from "react";
import { exportWidgetsPdf } from "@/lib/export";
import { usePrintRegistry } from "./printable";

export function PrintButton({
  title,
  subtitle,
  filenameBase,
}: {
  title: string;
  subtitle: string;
  filenameBase: string;
}) {
  const { entries } = usePrintRegistry();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"whole" | "select">("whole");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Every checked, every time the menu opens — so switching sections or
  // filters between one print and the next never leaves a stale pick
  // silently narrowing what gets exported. Adjusted during render (the
  // supported way to react to a changed value without an extra render
  // pass) rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected(new Set(entries.map((e) => e.id)));
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
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
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const noWidgets = entries.length === 0;
  const nothingChosen = mode === "select" && selected.size === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={noWidgets}
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/65 transition-colors hover:border-ink/30 hover:text-ink disabled:opacity-40"
      >
        Print
      </button>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col rounded-lg border border-ink/15 bg-white shadow-lg">
          <div className="flex flex-col gap-2 border-b border-ink/10 p-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={mode === "whole"} onChange={() => setMode("whole")} />
              Whole page
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={mode === "select"} onChange={() => setMode("select")} />
              Select widgets
            </label>
          </div>

          {mode === "select" && (
            <div className="max-h-64 overflow-y-auto p-1">
              {entries.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-gold/10"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 break-words">{e.label}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-3 py-2">
            <span className="text-xs text-ink/45">
              {mode === "whole"
                ? `${entries.length} widget${entries.length === 1 ? "" : "s"}`
                : `${selected.size} of ${entries.length}`}
            </span>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy || nothingChosen}
              className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Generating…" : "Download PDF"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
