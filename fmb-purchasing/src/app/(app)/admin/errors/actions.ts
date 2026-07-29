"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

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

export async function resolveAllErrors() {
  const user = await requireErrorsAdmin();

  const admin = createAdminClient();
  await admin
    .from("error_events")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .is("resolved_at", null);

  revalidatePath("/admin/errors");
}
