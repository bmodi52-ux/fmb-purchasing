/**
 * The events an alert rule can be built on (#28).
 *
 * Its own leaf module, free of server imports, so the rule builder can use it
 * in the browser without pulling the notification sender into the bundle.
 */

export type AlertEvent = "expense_submitted" | "expense_approved" | "expense_paid" | "vendor_added" | "budget_threshold";

export const ALERT_EVENTS: { event: AlertEvent; label: string }[] = [
  { event: "expense_submitted", label: "An expense is submitted" },
  { event: "expense_approved", label: "An expense is approved" },
  { event: "expense_paid", label: "An expense is paid" },
  { event: "vendor_added", label: "A vendor is added" },
  { event: "budget_threshold", label: "A category's budget passes a percentage" },
];
