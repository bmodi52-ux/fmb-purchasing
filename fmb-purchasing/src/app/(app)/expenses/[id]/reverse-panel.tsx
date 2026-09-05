"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

/**
 * Undoing a decision, with a reason.
 *
 * Approve, decline and paid were all terminal, so correcting a mistake meant
 * editing the row in the Supabase dashboard: off the record, invisible to the
 * audit trail, and available only to whoever holds the database password.
 *
 * Deliberately two steps. Reversing is rare and consequential — the one-click
 * version would sit next to "View receipt" waiting to be hit by accident — and
 * the pause is where the reason gets written. The reason is required because
 * six months later it is the only question anyone asks about the row.
 */
export function ReversePanel({
  expenseId,
  action,
  label,
  prompt,
  helpText,
}: {
  expenseId: string;
  action: (formData: FormData) => void;
  /** The button that opens the panel, e.g. "Reopen this decision". */
  label: string;
  /** The confirm button inside it. */
  prompt: string;
  helpText: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-ink/55 underline hover:text-maroon"
      >
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-maroon/25 bg-maroon/5 p-3">
      <input type="hidden" name="expense_id" value={expenseId} />
      <p className="text-sm text-ink/75">{helpText}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Why?</span>
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          placeholder="Approved in error — wrong vendor"
          className="input"
        />
      </label>
      <div className="flex gap-2">
        <SubmitButton
          disabled={!reason.trim()}
          className="rounded-md bg-maroon px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {prompt}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-ink/15 px-3.5 py-1.5 text-sm text-ink/70 hover:border-ink/30"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
