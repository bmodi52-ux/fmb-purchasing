"use client";

import { useState } from "react";
import type { IssuedCredentials } from "./actions";

/**
 * Shown once, after an account is created or its password reset. The
 * temporary password is not stored anywhere and can't be retrieved later, so
 * this is the only chance to pass it on by hand if the email doesn't arrive.
 */
export function IssuedCredentialsPanel({
  credentials,
  heading,
}: {
  credentials: IssuedCredentials;
  heading: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credentials.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the password is on screen anyway.
    }
  };

  return (
    <div className="w-full rounded-lg border border-gold/40 bg-gold/5 p-4">
      <p className="text-sm font-medium text-ink">
        {heading} {credentials.fullName}
      </p>

      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-ink/60">Email address</dt>
        <dd className="font-mono break-all">{credentials.email}</dd>
        <dt className="text-ink/60">Temporary password</dt>
        <dd className="flex items-center gap-2">
          <span className="font-mono select-all">{credentials.temporaryPassword}</span>
          <button
            type="button"
            onClick={copy}
            className="rounded border border-ink/15 px-1.5 py-0.5 text-xs text-ink/60 transition-colors hover:bg-white hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </dd>
      </dl>

      <p className="mt-3 text-xs text-ink/60">
        {credentials.emailed
          ? "Emailed to the address above. They'll be asked to choose their own password when they first sign in."
          : "The email could not be sent — pass this password on yourself. It won't be shown again."}
      </p>
    </div>
  );
}
