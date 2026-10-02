"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/errors";
import { setFavouriteReport } from "@/lib/reporting/favourites";
import { canSeeReport, findReport } from "@/lib/reporting/registry";

/**
 * Stars or unstars a report for whoever is signed in (0088). Only a report
 * that exists and that they may see: a star is a shortcut, not a way to learn
 * what reports there are.
 */
export async function setFavourite(reportKey: string, favourite: boolean): Promise<{ favourite: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const known = typeof reportKey === "string" && findReport(reportKey)?.key === reportKey;
  if (!known || !(await canSeeReport(user, reportKey))) throw new Error("That report can't be starred.");

  try {
    const now = await setFavouriteReport(createAdminClient(), user.id, reportKey, favourite);
    // Every report page shows its star, and the dashboard lists them.
    revalidatePath("/reports", "layout");
    return { favourite: now };
  } catch (error) {
    await reportError({ source: "report-favourites", error: error instanceof Error ? error.message : String(error), userId: user.id });
    throw new Error("The star couldn't be saved. Try again.");
  }
}
