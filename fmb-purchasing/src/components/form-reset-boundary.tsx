"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/**
 * Redraws its fields from the page's current values whenever the form around
 * it is reset.
 *
 * React resets a <form> once its action resolves, and a <select> is the one
 * field that comes back wrong. An uncontrolled one goes back to the value the
 * page first loaded with, because React never refreshes a select's default
 * after mount; a controlled one goes back to its first option while state
 * still holds the choice. Either way the dropdown shows something other than
 * what was saved, and saving again stores what it shows — Lamb Mince went
 * item → kg → item that way (#54).
 *
 * Remounting on reset is the general fix: the fields are created afresh from
 * props, which by then carry what the server saved. units-manager and
 * categories-manager write state back onto the DOM instead; that works for a
 * named select or two, this works for whatever is inside.
 */
export function FormResetBoundary({ children }: { children: React.ReactNode }) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) return;
    // The reset event fires before the fields are reset, and the state update
    // renders after, so the remount lands on top of the reset rather than
    // under it.
    const onReset = () => setGeneration((g) => g + 1);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <>
      <span ref={markerRef} hidden />
      <Fragment key={generation}>{children}</Fragment>
    </>
  );
}
