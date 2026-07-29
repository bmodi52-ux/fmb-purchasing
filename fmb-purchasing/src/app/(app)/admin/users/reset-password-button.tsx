"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { adminResetPassword, type ResetPasswordState } from "./actions";
import { IssuedCredentialsPanel } from "./issued-credentials";

const initialState: ResetPasswordState = { error: null, issued: null };

/**
 * Sits in a table cell, so the result can't render in place — a one-time
 * password needs room and shouldn't be missed. It goes in an overlay the
 * admin has to dismiss deliberately.
 */
export function ResetPasswordButton({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(adminResetPassword, initialState);

  if (state.issued) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-cream p-5 shadow-lg">
          <IssuedCredentialsPanel credentials={state.issued} heading="New password for" />
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 w-full rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-ink/60 hover:text-ink"
      >
        Reset password
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <SubmitButton className="text-xs font-medium text-maroon hover:underline">
        Reset {fullName.split(" ")[0]}&rsquo;s password?
      </SubmitButton>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-ink/50 hover:text-ink"
      >
        Cancel
      </button>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
