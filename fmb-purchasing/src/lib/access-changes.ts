/**
 * How a row of access_changes (0045) reads to a person.
 *
 * Pure, so it can be tested and shared by the Teams page and anywhere else a
 * person's access history is shown.
 */

export type AccessChangeRow = {
  id: string;
  changed_at: string;
  actor_id: string | null;
  kind: string;
  team_name: string | null;
  subject_name: string | null;
  page_key: string | null;
  action_key: string | null;
  detail: string | null;
};

export function describeAccessChange(
  row: AccessChangeRow,
  labels: { page: (key: string) => string; action: (key: string) => string }
): string {
  const team = row.team_name ? `“${row.team_name}”` : "a deleted team";
  const who = row.subject_name ?? "a removed account";
  const grant =
    row.page_key && row.action_key ? `${labels.action(row.action_key)} on ${labels.page(row.page_key)}` : "a permission";

  switch (row.kind) {
    case "permission_granted":
      return `Gave ${team} ${grant}`;
    case "permission_revoked":
      return `Took ${grant} away from ${team}`;
    case "member_added":
      return `Added ${who} to ${team}`;
    case "member_removed":
      return `Removed ${who} from ${team}`;
    case "team_created":
      return `Created the team ${team}`;
    case "team_renamed":
      return `Renamed a team to ${team}`;
    case "team_deleted":
      return `Deleted the team ${team}`;
    case "account_deactivated":
      return `Deactivated ${who}'s account`;
    case "account_reactivated":
      return `Reactivated ${who}'s account`;
    default:
      return row.kind;
  }
}

/** Who made the change, as the record should say it. */
export function accessChangeActor(row: AccessChangeRow, nameOf: (id: string) => string | undefined): string {
  if (row.detail?.startsWith("Automatically")) return "Automatic";
  if (!row.actor_id) return "Outside the app";
  return nameOf(row.actor_id) ?? "A removed account";
}
