/**
 * The kinds of notification, the ways each can arrive, and how a person's own
 * choices combine with their teams' (scratchpad #28).
 *
 * Pure and free of server imports, so the settings page can use it in the
 * browser and the tests can use it without a database.
 *
 * Three layers decide whether a kind arrives on a channel, strongest first:
 *
 *   1. Locked by the app — an escalation always arrives by push and email,
 *      because a reminder nobody acted on is not something to be missable.
 *   2. Required by one of the person's teams — set by an admin.
 *   3. The person's own choice, if they have made one.
 *   4. What their teams start members with, if any team says (on if any does).
 *   5. The app's default for that kind.
 */

export type Channel = "in_app" | "push" | "email";

export const CHANNELS: { channel: Channel; label: string }[] = [
  { channel: "in_app", label: "In the app" },
  { channel: "push", label: "Push" },
  { channel: "email", label: "Email" },
];

export type NotificationKind =
  | "expense_submitted"
  | "expense_to_review"
  | "expense_approved"
  | "expense_declined"
  | "expense_paid"
  | "system_error"
  | "reminder"
  | "escalation"
  | "announcement"
  | "alert"
  | "stand_in"
  | "receipt_received";

/** Who a kind can reach at all, so nobody is offered settings for things they never receive. */
export type Audience = "everyone" | "approvers" | "payers" | "admins" | "reviewers";

export type KindDefinition = {
  kind: NotificationKind;
  label: string;
  description: string;
  audience: Audience[];
  defaults: Record<Channel, boolean>;
  /** Channels that are always on for this kind, whatever anyone chooses. */
  locked?: Partial<Record<Channel, true>>;
};

export const NOTIFICATION_KINDS: KindDefinition[] = [
  {
    kind: "expense_to_review",
    label: "An expense to approve",
    description: "Someone submitted an expense that is waiting for a decision.",
    audience: ["approvers"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "expense_submitted",
    label: "Your expense was submitted",
    description: "Confirmation that an expense you submitted has arrived.",
    audience: ["everyone"],
    defaults: { in_app: true, push: false, email: false },
  },
  {
    kind: "expense_approved",
    label: "Your expense was approved",
    description: "An expense you submitted was approved and is ready to be paid.",
    audience: ["everyone"],
    defaults: { in_app: true, push: false, email: false },
  },
  {
    kind: "expense_declined",
    label: "Your expense was declined",
    description: "An expense you submitted was declined, with the reason.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "expense_paid",
    label: "Your expense was paid",
    description: "An expense you submitted has been paid.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "receipt_received",
    label: "A receipt you emailed in",
    description: "A receipt you forwarded to the app's address is ready to submit.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "reminder",
    label: "Daily reminder of things waiting",
    description: "One summary a day when something has waited too long for you.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: true },
  },
  {
    kind: "escalation",
    label: "Something has waited far too long",
    description: "Sent when a reminder was not acted on. Always arrives by push and email.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: true },
    locked: { push: true, email: true },
  },
  {
    kind: "stand_in",
    label: "Stand-ins",
    description: "You have been named as someone's stand-in, or a stand-in was arranged.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: true },
  },
  {
    kind: "announcement",
    label: "Announcements",
    description: "Messages from the admins, such as purchasing deadlines.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "alert",
    label: "Alerts",
    description: "Alerts an admin has set up, such as a large expense from an event.",
    audience: ["everyone"],
    defaults: { in_app: true, push: true, email: false },
  },
  {
    kind: "system_error",
    label: "Something failed in the background",
    description: "A receipt that would not read, an email that did not send.",
    audience: ["admins"],
    defaults: { in_app: true, push: false, email: false },
  },
];

export const KIND_BY_KEY = new Map(NOTIFICATION_KINDS.map((k) => [k.kind, k]));

export type TeamSetting = { enabled: boolean; required: boolean };

export type ChannelState = {
  enabled: boolean;
  /** Why the person cannot change it, when they cannot. */
  lockedBy: "app" | "team" | null;
};

/**
 * Whether one kind arrives on one channel for one person.
 *
 * `own` is the person's choice, or undefined when they have not made one.
 * `teams` is every setting their teams have for this kind and channel.
 */
export function channelState(
  kind: NotificationKind,
  channel: Channel,
  own: boolean | undefined,
  teams: TeamSetting[]
): ChannelState {
  const definition = KIND_BY_KEY.get(kind);
  if (definition?.locked?.[channel]) return { enabled: true, lockedBy: "app" };
  if (teams.some((t) => t.required)) return { enabled: true, lockedBy: "team" };
  if (own !== undefined) return { enabled: own, lockedBy: null };
  if (teams.length > 0) return { enabled: teams.some((t) => t.enabled), lockedBy: null };
  return { enabled: definition?.defaults[channel] ?? false, lockedBy: null };
}
