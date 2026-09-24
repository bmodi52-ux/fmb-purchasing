/**
 * A background failure, said in words (#22).
 *
 * The notice used to be "Something failed in the background" over the raw
 * error — on 22/09 that was 29 copies of a JSON blob from the receipt
 * reader. The raw text belongs on System errors, where whoever fixes it
 * reads it; the notice only has to say what broke, whether anyone was left
 * stuck, and where the details are.
 */

/** What each part of the app was doing, as the subject of a sentence. */
const WHAT: Record<string, string> = {
  "receipt-extraction": "Reading a receipt",
  "receipt-upload": "Uploading a receipt",
  "receipt-too-large": "A receipt upload",
  "product-photo-extraction": "Reading a product photo",
  "product-photo-save": "Saving an item from a photo",
  "product-link": "Reading a shop's page",
  "extraction-check": "The receipt reader check",
  "inbound-email": "A receipt sent by email",
  "email-send": "Sending an email",
  "password-reset": "A password reset email",
  "expense-create": "Saving a new expense",
  "expense-update": "Saving changes to an expense",
  "expense-decision": "Approving or declining an expense",
  "expense-reopen": "Reopening an expense",
  "expense-withdraw": "Withdrawing an expense",
  "expense-payment": "Marking an expense paid",
  "payment-reversal": "Reversing a payment",
  "bank-reconcile": "Checking a bank statement",
  "line-capital": "Marking a line as capital",
  "menu-allocation": "Allocating a receipt to a thaali day",
  "thaali-nudges": "The thaali buying reminders",
  "daily-reminders": "The daily reminders",
  "records-reminder": "The backup reminder",
  "stand-ins": "The stand-in handover",
  "abn-lookup": "Looking up an ABN",
  "abn-lookup-search": "Searching the ABN register",
  abr: "Looking up an ABN",
  budgets: "Saving a budget",
  "budget-phasing": "Saving a budget's phasing",
  "account-codes": "Saving account codes",
  "locked-periods": "Locking a GST period",
  "app-settings": "Saving app settings",
  "notification-defaults": "Saving notification defaults",
  announcements: "Sending an announcement",
  "alert-rules": "Saving an alert rule",
  "users-admin": "Changing a user account",
  "teams-admin": "Changing a team",
  "item-buying": "Saving an item's buying details",
  "category-price-limits": "Saving price limits",
  "saved-report-views": "Saving a report view",
  "slow-page-load": "A page",
};

/** The kind of fault, read from the raw message, in terms a non-developer can act on. */
function why(message: string): string {
  const m = message.toLowerCase();
  if (/\b429\b|rate.?limit|overloaded|\b529\b/.test(m)) return "The AI service was busy. It usually clears up on its own.";
  if (/timed? ?out|timeout|etimedout|aborted/.test(m)) return "It took too long and was stopped.";
  if (/fetch failed|enotfound|econnre|network|socket/.test(m)) return "The connection to another service dropped.";
  if (/\b401\b|\b403\b|api.?key|unauthori[sz]ed|forbidden/.test(m))
    return "Another service refused the app's credentials. A key may need renewing.";
  if (/\b400\b|invalid_request/.test(m)) return "Another service rejected the request the app sent. This needs a code fix.";
  if (/\b5\d\d\b/.test(m)) return "Another service had an error of its own.";
  if (/violates|duplicate key|constraint|relation .* does not exist|column .* does not exist/.test(m))
    return "The database refused the change.";
  if (/slow to load/.test(m)) return "It was very slow to load.";
  return "Something unexpected went wrong.";
}

export function describeFailure(source: string, message: string): { title: string; body: string } {
  const what = WHAT[source];
  const title = what ? `${what} failed` : "Something failed in the background";
  return {
    title: source === "slow-page-load" ? "A page was very slow to load" : title,
    body: `${why(message)} Details are on System errors.`,
  };
}
