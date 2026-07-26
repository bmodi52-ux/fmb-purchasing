"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Username</span>
        <input
          name="username"
          autoComplete="username"
          required
          className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
        />
      </label>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
