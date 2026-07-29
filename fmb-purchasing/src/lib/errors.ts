import { createAdminClient } from "@/lib/supabase/admin";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";

/**
 * Records a failure where someone will actually see it.
 *
 * Recurrences of the same fault collapse onto one row (see migration 0021),
 * and only the first occurrence notifies — a list that announces every
 * repetition of a recurring problem is a list people learn to ignore.
 *
 * Never throws and never rethrows. This is called from catch blocks; a
 * monitoring failure must not become the error the user sees, and must not
 * mask the original.
 */
export async function reportError({
  source,
  error,
  detail,
  userId,
  expenseId,
}: {
  /** Which part of the app failed, e.g. "receipt-extraction". */
  source: string;
  error: unknown;
  /** Extra context worth having when someone comes to reproduce it. */
  detail?: string;
  userId?: string | null;
  expenseId?: string | null;
}): Promise<void> {
  const message = errorMessage(error);

  // Still goes to the platform log: if the database is what's broken, that's
  // the only place this can land.
  console.error(`[${source}] ${message}`, error);

  try {
    const admin = createAdminClient();

    const { data: isNew, error: rpcError } = await admin.rpc("record_error_event", {
      p_source: source,
      p_message: message,
      p_detail: detail ?? stackOf(error),
      p_user_id: userId ?? null,
      p_expense_id: expenseId ?? null,
    });

    if (rpcError) {
      console.error("[errors] could not record error event:", rpcError.message);
      return;
    }
    if (!isNew) return;

    const adminIds = await userIdsWithPermission(admin, "admin_users", "manage_users");
    await notify(
      admin,
      adminIds.map((id) => ({
        userId: id,
        kind: "system_error" as const,
        title: "Something failed in the background",
        body: `${source}: ${message}`,
        link: "/admin/errors",
      }))
    );
  } catch (reportingFailure) {
    console.error("[errors] reporting threw:", reportingFailure);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stackOf(error: unknown): string | null {
  return error instanceof Error && error.stack ? error.stack : null;
}
