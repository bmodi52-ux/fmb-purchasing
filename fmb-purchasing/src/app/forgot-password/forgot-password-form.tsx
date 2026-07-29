"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, sent: false };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.sent) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink/80">
          If there&rsquo;s an account with that email address, a link to choose a new
          password is on its way. It can take a minute to arrive — check your junk
          folder if it doesn&rsquo;t.
        </p>
        <a
          href="/login"
          className="rounded-md bg-gold px-4 py-2 text-center font-medium text-ink transition-colors hover:bg-gold-deep"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
        />
      </label>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <a href="/login" className="text-center text-sm text-ink/60 underline hover:text-ink">
        Back to sign in
      </a>
    </form>
  );
}
