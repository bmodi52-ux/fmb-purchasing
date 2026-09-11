"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { setSetting } from "@/lib/app-settings";
import { reportError } from "@/lib/errors";

async function requireSettingsAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");
  return user;
}

export async function setCapitalThreshold(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const amount = Number(String(formData.get("amount") ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter the threshold as an amount in dollars, such as 1000.");
  }

  const { error } = await setSetting(createAdminClient(), "capital_purchase_threshold", amount, user.id);
  if (error) {
    await reportError({ source: "app-settings", error, detail: "capital_purchase_threshold", userId: user.id });
    throw new Error("The setting could not be saved. Try again.");
  }
  revalidatePath("/admin/settings");
}

export async function setDuplicateFlags(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const on = String(formData.get("on")) === "true";

  const { error } = await setSetting(createAdminClient(), "duplicate_flags_for_reviewers", on, user.id);
  if (error) {
    await reportError({ source: "app-settings", error, detail: "duplicate_flags_for_reviewers", userId: user.id });
    throw new Error("The setting could not be saved. Try again.");
  }

  revalidatePath("/admin/settings");
  revalidatePath("/approvals");
  revalidatePath("/payments");
}
