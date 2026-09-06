"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { revalidateReports } from "../../reports/data";

async function requireErrorsAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Reuses the users-admin grant rather than introducing a page key nobody
  // has been granted yet — whoever administers accounts is who should see
  // that something is broken.
  await requirePermission(user, "admin_users", "manage_users");
  return user;
}

export async function resolveError(formData: FormData) {
  const user = await requireErrorsAdmin();
  const id = String(formData.get("error_id"));

  const admin = createAdminClient();
  await admin
    .from("error_events")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", id);

  revalidatePath("/admin/errors");
}

/**
 * Forces the Reports ledger cache to be read again.
 *
 * Every write through the app already does this — see revalidateReports() —
 * so this exists for the one case that does not: a change made outside the
 * app. Running the reset script, correcting a row in the Supabase dashboard,
 * or restoring a backup all leave Reports serving figures from before, for up
 * to an hour, with nothing on screen to say so.
 *
 * That happened during the review work: operational data was cleared straight
 * through the database, and Reports went on showing a $100.07 total against an
 * empty ledger. The figures were not wrong so much as old, but there was no
 * way to tell the difference and no way to fix it but wait.
 *
 * Lives on the errors page because that is where an admin already goes when
 * something looks wrong, and because it is deliberately not somewhere a
 * reader would find it — each refresh re-reads the whole ledger.
 */
export async function refreshReportData() {
  await requireErrorsAdmin();
  revalidateReports();
  revalidatePath("/admin/errors");
}

export async function resolveAllErrors() {
  const user = await requireErrorsAdmin();

  const admin = createAdminClient();
  await admin
    .from("error_events")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .is("resolved_at", null);

  revalidatePath("/admin/errors");
}
