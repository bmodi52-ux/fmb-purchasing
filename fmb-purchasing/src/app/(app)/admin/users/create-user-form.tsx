"use client";

import { useActionState, useRef, useEffect } from "react";
import { createUser, type CreateUserState } from "./actions";

const initialState: CreateUserState = { error: null };

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && state.error === null) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-ink/10 bg-white/60 p-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Username</span>
        <input
          name="username"
          required
          className="w-40 rounded-md border border-ink/15 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Full name</span>
        <input
          name="full_name"
          required
          className="w-48 rounded-md border border-ink/15 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Contact email</span>
        <input
          name="email"
          type="email"
          required
          className="w-56 rounded-md border border-ink/15 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Temporary password</span>
        <input
          name="password"
          type="text"
          required
          minLength={8}
          className="w-40 rounded-md border border-ink/15 bg-white px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create user"}
      </button>
      {state.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
