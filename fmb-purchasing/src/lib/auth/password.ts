import { randomInt } from "crypto";

/**
 * Minimum length for a password a user chooses themselves. Supabase's own
 * default is 6; 8 is the usual floor and this app has no other complexity
 * requirement, so it does the work on its own.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Characters that can't be confused with one another when a temporary
 * password is read off a screen or a phone: no I/l/1, no O/0.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * A temporary password for a newly created account, in `abcd-efgh-ijkl` form.
 *
 * 12 characters from a 56-character alphabet is roughly 69 bits — far beyond
 * anything guessable, and it only has to survive until first sign-in, which
 * forces a change. Hyphenated because someone usually has to retype it from
 * an email into another device.
 *
 * `randomInt` is the crypto-grade generator; `Math.random` is not, and is
 * never appropriate for a credential.
 */
export function generateTemporaryPassword(): string {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  ).join("-");
}

/** Addresses are compared and stored case-insensitively throughout. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}

/**
 * Shared by the change-password and reset-password flows so the rules can't
 * drift apart. Returns an error message, or null when acceptable.
 */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Your new password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "The two passwords don't match.";
  }
  return null;
}
