import { TRAINEES } from "@/lib/sandbox-trainees";

/**
 * What makes the sandbox behave differently from the live site (#1).
 *
 * The code is identical in both places — the sandbox gets every change when it
 * is merged — so the difference is one environment variable and the two things
 * it changes: a banner nobody can miss, and email that only ever reaches a
 * trainee.
 */

export const SANDBOX_SUBJECT_PREFIX = "[Sandbox] ";

export function isSandbox(): boolean {
  return process.env.NEXT_PUBLIC_SANDBOX === "1";
}

/** Subjects say so, so a sandbox email is never mistaken for a real one. */
export function sandboxSubject(subject: string): string {
  return subject.startsWith(SANDBOX_SUBJECT_PREFIX) ? subject : `${SANDBOX_SUBJECT_PREFIX}${subject}`;
}

/**
 * Who an email may actually reach from the sandbox.
 *
 * Everything copied from live is scrubbed, so those addresses are either
 * invented (and would bounce, which costs the real domain its reputation) or,
 * worse, a real person's, who would get mail about training data. Two kinds of
 * address are written to: trainees, and `accountHolders` — the sandbox's own
 * logins, which an admin created there on purpose and expects to reach. The
 * rest are reported so the log says what was held back rather than going quiet.
 */
export function sandboxRecipients(
  to: string[],
  accountHolders: Iterable<string> = []
): { send: string[]; held: string[] } {
  const allowed = new Set([...TRAINEES.map((t) => t.email), ...accountHolders].map(normalize));
  const send: string[] = [];
  const held: string[] = [];
  for (const address of to) {
    const ok = allowed.has(normalize(address)) && !isScrubbed(address);
    (ok ? send : held).push(address);
  }
  return { send, held };
}

function normalize(address: string): string {
  return address.trim().toLowerCase();
}

/** The scrub's invented addresses (sandbox-scrub.ts) can never receive. */
export function isScrubbed(address: string): boolean {
  return normalize(address).endsWith(".invalid");
}
