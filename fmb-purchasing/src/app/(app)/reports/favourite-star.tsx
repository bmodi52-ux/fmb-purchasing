"use client";

import { useState, useTransition } from "react";
import { setFavourite } from "./favourite-actions";

/**
 * The star on a report: filled when it is one of your favourites. It turns
 * at once and is put back if saving fails, with a word to say so.
 */
export function FavouriteStar({ reportKey, title, initial }: { reportKey: string; title: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setFailed(false);
    start(async () => {
      try {
        const saved = await setFavourite(reportKey, next);
        setOn(saved.favourite);
      } catch {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        aria-label={on ? `Remove ${title} from your favourites` : `Add ${title} to your favourites`}
        title={on ? "A favourite — select to remove" : "Add to favourites"}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-colors hover:bg-ink/5 ${
          on ? "text-gold" : "text-ink/30 hover:text-ink/60"
        }`}
      >
        <span aria-hidden="true">{on ? "★" : "☆"}</span>
      </button>
      {failed && <span className="text-xs text-danger">Not saved — try again</span>}
    </span>
  );
}
