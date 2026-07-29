"use client";

import { SubmitButton } from "@/components/submit-button";
import { useActionState, useRef, useEffect } from "react";
import { createUser, type CreateUserState } from "./actions";
import { IssuedCredentialsPanel } from "./issued-credentials";

const initialState: CreateUserState = { error: null, created: null };

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && state.created) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <div className="flex flex-col gap-3">
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-ink/10 bg-white/60 p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Full name</span>
          <input
            name="full_name"
            required
            className="w-48 rounded-md border border-ink/15 bg-white px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Email address</span>
          <input
            name="email"
            type="email"
            required
            className="w-64 rounded-md border border-ink/15 bg-white px-3 py-2"
          />
        </label>
        <SubmitButton
          disabled={pending}
          className="rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create user"}
        </SubmitButton>
        <p className="w-full text-xs text-ink/55">
          A temporary password is generated and emailed to them. They choose their own
          the first time they sign in.
        </p>
        {state.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
      </form>

      {state.created && (
        <IssuedCredentialsPanel credentials={state.created} heading="Account created for" />
      )}
    </div>
  );
}
