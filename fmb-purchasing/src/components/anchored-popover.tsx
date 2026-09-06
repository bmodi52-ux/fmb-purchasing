"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A popover that cannot be clipped by whatever it is nested inside.
 *
 * Every suggestion list in this app used to be an absolutely positioned child
 * of its input. That works until the input sits inside a scroll container —
 * and the line-items table on Submit is wrapped in `overflow-x-auto` so it can
 * scroll sideways on a phone. CSS makes that fatal: once one axis is not
 * `visible`, the other computes from `visible` to `auto`, so the wrapper
 * clipped and scrolled vertically too. The item search dropdown was rendered
 * below the last row, outside the box, and the only evidence it existed was a
 * vertical scrollbar appearing at the edge of the table.
 *
 * Rendering into a portal at `position: fixed` sidesteps containment
 * altogether: the list is a child of <body>, so no ancestor's overflow can
 * touch it, and it is placed from the anchor's viewport rect instead of by
 * layout. That costs having to re-measure — hence the scroll and resize
 * listeners — but it is the only approach that keeps working wherever the
 * input is put, which matters because the same lists are about to appear in
 * table headers.
 */
export function AnchoredPopover({
  anchorRef,
  open,
  children,
  minWidth = 288,
  align = "start",
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
  /** Floor for the popover width; it never renders narrower than its anchor. */
  minWidth?: number;
  /** Which edge to line up with the anchor when the popover is wider. */
  align?: "start" | "end";
}) {
  // Null until the anchor has been measured, which can only happen in the
  // browser — so this doubles as the guard that keeps createPortal away from
  // the server pass, where there is no document to portal into.
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    // Reading layout out of the DOM is exactly the external-system case
    // effects are for; the lint rule cannot tell that apart from deriving
    // state, and deriving is not what this is.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!open) {
      setRect(null);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    const measure = () => {
      const el = anchorRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    measure();

    // Capture phase, because the scroll that moves the anchor is usually a
    // container's rather than the window's, and those do not bubble.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, anchorRef]);

  if (!open || !rect) return null;

  const width = Math.max(rect.width, minWidth);
  // Flip above the anchor when there is more room up there — a line near the
  // bottom of a long form would otherwise open a list that runs off-screen.
  const spaceBelow = window.innerHeight - rect.bottom;
  const flip = spaceBelow < 180 && rect.top > spaceBelow;

  const style: React.CSSProperties = {
    position: "fixed",
    width,
    maxHeight: Math.max(120, (flip ? rect.top : spaceBelow) - 12),
    ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    // Keep the list on screen when the anchor sits near an edge.
    left: Math.min(
      Math.max(8, align === "end" ? rect.right - width : rect.left),
      Math.max(8, window.innerWidth - width - 8)
    ),
  };

  return createPortal(
    <div style={style} className="z-50 overflow-y-auto rounded-md border border-ink/15 bg-white text-sm shadow-lg">
      {children}
    </div>,
    document.body
  );
}
