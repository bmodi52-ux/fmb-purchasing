/**
 * Explicit locale everywhere dates are rendered — toLocaleDateString()
 * without one depends on the runtime's default locale, which differs
 * between the Node server and the browser and causes hydration mismatches.
 */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-AU");
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString("en-AU");
}
