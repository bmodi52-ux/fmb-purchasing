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

/** The reminder limits and escalation teams (#27). */
export async function setReminders(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const days = (key: string, fallback: number) => {
    const n = Math.round(Number(formData.get(key)));
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : fallback;
  };
  const team = (key: string) => String(formData.get(key) ?? "") || null;
  const queue = (name: string, first: number, escalate: number) => {
    const firstAfterDays = days(`${name}_first`, first);
    return {
      firstAfterDays,
      escalateAfterDays: Math.max(firstAfterDays, days(`${name}_escalate`, escalate)),
      escalateTeamId: team(`${name}_team`),
    };
  };

  const value = {
    enabled: formData.get("enabled") === "on",
    approvals: queue("approvals", 2, 5),
    payments: queue("payments", 3, 7),
    bankAccounts: queue("bankAccounts", 1, 3),
    declinedAfterDays: days("declined", 3),
    masterDataWeekday: Math.min(6, days("weekday", 1)),
  };

  const { error } = await setSetting(createAdminClient(), "reminders", value, user.id);
  if (error) {
    await reportError({ source: "app-settings", error, detail: "reminders", userId: user.id });
    throw new Error("The reminder settings could not be saved. Try again.");
  }
  revalidatePath("/admin/settings");
}

/** FMB's own bank details for batch payment files (#37). */
export async function setAbaSettings(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const value = {
    bankAbbreviation: text("bank").toUpperCase().slice(0, 3),
    userName: text("user_name").slice(0, 26),
    userId: text("user_id").replace(/\D/g, "").slice(0, 6),
    bsb: text("bsb").replace(/\D/g, "").slice(0, 6),
    accountNumber: text("account_number").replace(/\D/g, "").slice(0, 9),
    remitterName: text("remitter_name").slice(0, 16) || "FMB SYDNEY",
    description: text("description").slice(0, 12) || "PAYMENTS",
    balancing: formData.get("balancing") === "on",
  };
  const { error } = await setSetting(createAdminClient(), "aba", value, user.id);
  if (error) {
    await reportError({ source: "app-settings", error, detail: "aba", userId: user.id });
    throw new Error("The bank file settings could not be saved. Try again.");
  }
  revalidatePath("/admin/settings");
}

export async function setRemittanceEmails(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const { error } = await setSetting(createAdminClient(), "remittance_emails", String(formData.get("on")) === "true", user.id);
  if (error) throw new Error("The setting could not be saved. Try again.");
  revalidatePath("/admin/settings");
}

/** The built-in budget alerts (#39): on or off, and at which percentages. */
export async function setBudgetAlerts(formData: FormData): Promise<void> {
  const user = await requireSettingsAdmin();
  const percents = String(formData.get("percents") ?? "")
    .split(/[\s,]+/)
    .map((p) => Math.round(Number(p.replace("%", ""))))
    .filter((p) => Number.isFinite(p) && p > 0 && p <= 500);
  const { error } = await setSetting(
    createAdminClient(),
    "budget_alerts",
    { enabled: formData.get("enabled") === "on", percents: [...new Set(percents)].sort((a, b) => a - b) },
    user.id
  );
  if (error) throw new Error("The setting could not be saved. Try again.");
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
