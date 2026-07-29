"use client";

import Link from "next/link";
import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "./actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

const initialState: ChangePasswordState = { error: null };

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoFocus
          className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
        />
      </label>

      <p className="text-xs text-ink/55">At least {PASSWORD_MIN_LENGTH} characters.</p>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>

      {!forced && (
        <Link href="/" className="text-center text-sm text-ink/60 underline hover:text-ink">
          Cancel
        </Link>
      )}
    </form>
  );
}
