import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The migrations this build of the app expects its database to have — see
 * migration 0041.
 *
 * A list in code rather than a read of supabase/migrations, because the
 * deployed app has no migrations folder to read. migrations.test.ts fails if
 * this list and the folder ever disagree, so adding a migration without adding
 * it here fails CI rather than going unnoticed.
 *
 * Only 0041 onwards: that is where the ledger starts, and 0041 backfills
 * everything before it.
 */
export const LEDGERED_MIGRATIONS = [
  "0041_schema_migrations.sql",
  "0042_atomic_decisions_and_payments.sql",
  "0043_withdrawn_status.sql",
  "0044_withdraw_expenses.sql",
  "0045_access_changes.sql",
  "0046_app_settings.sql",
  "0047_vendor_gst_registration.sql",
  "0048_gst_checks.sql",
  "0049_budget_periods.sql",
  "0050_notification_channels.sql",
  "0051_stand_ins.sql",
  "0052_finance.sql",
  "0053_price_alerts_and_saved_views.sql",
  "0054_receipt_capture.sql",
  "0055_records.sql",
  "0056_offline_receipts.sql",
] as const;

export type MigrationStatus =
  | { state: "current" }
  /** The ledger itself is missing, so 0041 has not been run. */
  | { state: "no_ledger" }
  /** Files this code expects that the database has not had. */
  | { state: "behind"; missing: string[] }
  | { state: "unknown"; error: string };

/**
 * Compares the database's ledger with what this build expects.
 *
 * "Ahead" is deliberately not reported: a database that has had a migration
 * this build does not know about is the normal state for a moment during
 * every deploy — the migration is run, then the code merged — and flagging it
 * would teach people to ignore the warning.
 */
export async function migrationStatus(admin: SupabaseClient): Promise<MigrationStatus> {
  const { data, error } = await admin.from("schema_migrations").select("filename");

  if (error) {
    // PostgREST reports a missing relation as 42P01 or, through its schema
    // cache, PGRST205.
    if (error.code === "42P01" || error.code === "PGRST205") return { state: "no_ledger" };
    return { state: "unknown", error: error.message };
  }

  const applied = new Set((data ?? []).map((r) => r.filename as string));
  const missing = LEDGERED_MIGRATIONS.filter((f) => !applied.has(f));
  return missing.length === 0 ? { state: "current" } : { state: "behind", missing };
}
