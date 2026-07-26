const LOGIN_EMAIL_DOMAIN = "login.fmbpurchasing.internal";

/**
 * Login is by username/password (§2 — manual accounts, ITS OneLogin/SAML
 * comes later). Supabase Auth requires an email identity under the hood, so
 * each user gets a deterministic, never-delivered-to address derived from
 * their username. Real contact email for notifications (§7) is stored
 * separately on profiles.email.
 */
export function usernameToAuthEmail(username: string): string {
  return `${normalizeUsername(username)}@${LOGIN_EMAIL_DOMAIN}`;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(username));
}
