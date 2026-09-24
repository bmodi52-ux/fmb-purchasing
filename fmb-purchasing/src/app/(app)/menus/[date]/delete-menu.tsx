"use client";

import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { SubmitButton } from "@/components/submit-button";
import { deleteMenuDay } from "../actions";

/**
 * "Delete this menu", behind a confirmation (#21). Nothing about a day comes
 * back once it is gone, so the button only opens the question.
 */
export function DeleteMenu({
  dayId,
  date,
  dateLabel,
  kitchenId,
  kitchenName,
  released,
  blockedBecause,
}: {
  dayId: string;
  date: string;
  dateLabel: string;
  kitchenId: string;
  kitchenName: string;
  released: boolean;
  /** Set when the day has buying against it and so cannot be deleted. */
  blockedBecause: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (blockedBecause) {
    return <p className="text-xs text-ink/50">This menu can&apos;t be deleted: {blockedBecause}</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-quiet btn-xs text-maroon"
      >
        Delete this menu
      </button>
      {open && (
        <Dialog title="Delete this menu?" onClose={() => setOpen(false)} className="w-full max-w-md rounded-lg border border-ink/10 bg-cream p-6 shadow-lg">
          <p className="text-sm text-ink/80">
            Everything planned for {dateLabel} in {kitchenName} goes: the dishes, roti and fruit, anything typed in, and
            the thaali counts and notes.
            {released && " It has been released, so its shopping lists are taken back too. Nothing on them has been bought yet."}
          </p>
          <p className="mt-2 text-sm text-ink/60">This can&apos;t be undone.</p>
          <form action={deleteMenuDay} className="mt-5 flex justify-end gap-2">
            <input type="hidden" name="menu_day_id" value={dayId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="kitchen_id" value={kitchenId} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-secondary"
            >
              Keep it
            </button>
            <SubmitButton
              pendingLabel="Deleting…"
              className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-cream hover:bg-maroon/90"
            >
              Delete menu
            </SubmitButton>
          </form>
        </Dialog>
      )}
    </>
  );
}
