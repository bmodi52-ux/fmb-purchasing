"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A modal that behaves like one.
 *
 * Every dialog in this app was a positioned `<div>`: no role, no `aria-modal`,
 * no focus management. A screen reader announced nothing when one opened, and
 * a keyboard user pressing Tab walked straight out of the dialog into the page
 * behind it — where the controls are still there, still clickable, and covered
 * by an overlay they cannot see past.
 *
 * Four things make the difference, and they are the same four every time,
 * which is why this exists once rather than in each dialog:
 *
 *   - `role="dialog"` and `aria-modal`, so it is announced as a dialog
 *   - a label, taken from the heading the dialog already renders
 *   - Tab cycling within the dialog, so focus cannot escape
 *   - focus moved in on open and returned to the opener on close, so a
 *     keyboard user is not dropped at the top of the document
 *
 * Escape and a click on the backdrop both close, because both are what people
 * try. Neither is the only way out: the close button is always in the tab
 * order first.
 */
export function Dialog({
  title,
  onClose,
  children,
  className = "w-full max-w-xl rounded-lg border border-ink/10 bg-cream p-6 shadow-lg",
  align = "center",
}: {
  /** Names the dialog for assistive technology, and is rendered as its heading. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Long forms start at the top so they do not jump as they grow. */
  align?: "center" | "start";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetParent !== null);
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

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Returning focus is what makes closing feel like going back rather than
      // like the page resetting.
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-ink/40 p-4 ${
        align === "start" ? "items-start overflow-y-auto py-10" : "items-center"
      }`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={headingId} className="section-title text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="-m-2 shrink-0 p-2 text-ink/50 hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
