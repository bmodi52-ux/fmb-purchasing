"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { reportError } from "@/lib/errors";
import { canSeeView, type ViewSharing } from "@/lib/saved-report-views";
import { SECTIONS, type CompareDimension, type ReportQuery } from "./report-filters";

/**
 * Saving, sharing, copying and deleting report views (#41). Every change is
 * checked against the owner here — the database has no policies of its own.
 */

async function requireReports() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");
  return user;
}

const DIMENSIONS: CompareDimension[] = ["item", "category", "vendor"];

/** A report query as the page would build it, whatever was posted. */
function queryFrom(raw: unknown): ReportQuery | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const q = value as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 200) : [];
  const period = typeof q.period === "string" && q.period.length <= 64 ? q.period : null;
  if (!period) return null;
  return {
    period,
    section: SECTIONS.some((s) => s.key === q.section) ? (q.section as ReportQuery["section"]) : "overview",
    vendors: list(q.vendors),
    categories: list(q.categories),
    items: list(q.items),
    breakdownBy: DIMENSIONS.includes(q.breakdownBy as CompareDimension) ? (q.breakdownBy as CompareDimension) : "category",
    compareBy: DIMENSIONS.includes(q.compareBy as CompareDimension) ? (q.compareBy as CompareDimension) : "item",
  };
}

function sharingFrom(formData: FormData): { sharedWith: ViewSharing; teamIds: string[] } {
  const raw = String(formData.get("shared_with") ?? "private");
  const sharedWith: ViewSharing = raw === "reports" || raw === "teams" ? raw : "private";
  const teamIds = sharedWith === "teams" ? formData.getAll("team_ids").map(String).filter(Boolean) : [];
  return { sharedWith, teamIds };
}

export type SavedViewState = { status: "idle" | "saved" | "error"; message?: string };

async function writeTeams(viewId: string, teamIds: string[]) {
  const admin = createAdminClient();
  await admin.from("saved_report_view_teams").delete().eq("view_id", viewId);
  if (teamIds.length) {
    const { data: teams } = await admin.from("teams").select("id").in("id", teamIds);
    const valid = (teams ?? []).map((t) => t.id as string);
    if (valid.length) {
      await admin.from("saved_report_view_teams").insert(valid.map((team_id) => ({ view_id: viewId, team_id })));
    }
  }
}

/**
 * Saves what is on screen as a new view, or — given a view the person owns —
 * renames it, changes who it is shared with, and (when asked) points it at
 * what is on screen now.
 */
export async function saveReportView(_prev: SavedViewState, formData: FormData): Promise<SavedViewState> {
  const user = await requireReports();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { status: "error", message: "Give the view a name, such as “Meat this year by vendor”." };
  const { sharedWith, teamIds } = sharingFrom(formData);
  if (sharedWith === "teams" && teamIds.length === 0) return { status: "error", message: "Choose at least one team." };

  const viewId = String(formData.get("view_id") ?? "");
  const replaceQuery = !viewId || formData.get("replace_query") === "on";
  const query = replaceQuery ? queryFrom(formData.get("query")) : null;
  if (replaceQuery && !query) return { status: "error", message: "The report on screen could not be read. Reload and try again." };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (viewId) {
    const { data: existing } = await admin.from("saved_report_views").select("owner_id").eq("id", viewId).maybeSingle();
    if (!existing) return { status: "error", message: "That view no longer exists." };
    if (existing.owner_id !== user.id) return { status: "error", message: "Only the person who saved a view can change it." };
    const { error } = await admin
      .from("saved_report_views")
      .update({ name, shared_with: sharedWith, updated_at: now, ...(query ? { query } : {}) })
      .eq("id", viewId);
    if (error) {
      await reportError({ source: "saved-report-views", error: error.message, userId: user.id });
      return { status: "error", message: "The view could not be saved. Try again." };
    }
    await writeTeams(viewId, teamIds);
    revalidatePath("/reports");
    return { status: "saved", message: `Saved “${name}”.` };
  }

  const { data: created, error } = await admin
    .from("saved_report_views")
    .insert({ owner_id: user.id, name, query, shared_with: sharedWith, created_at: now, updated_at: now })
    .select("id")
    .single();
  if (error || !created) {
    await reportError({ source: "saved-report-views", error: error?.message ?? "no row", userId: user.id });
    return { status: "error", message: "The view could not be saved. Try again." };
  }
  await writeTeams(created.id as string, teamIds);
  revalidatePath("/reports");
  return { status: "saved", message: `Saved “${name}”.` };
}

export async function deleteReportView(formData: FormData): Promise<void> {
  const user = await requireReports();
  const viewId = String(formData.get("view_id") ?? "");
  if (!viewId) return;
  // Scoped by owner as well as id: the id alone must not be enough.
  await createAdminClient().from("saved_report_views").delete().eq("id", viewId).eq("owner_id", user.id);
  revalidatePath("/reports");
}

/** A copy of a view someone can see, as their own and private to them. */
export async function copyReportView(formData: FormData): Promise<void> {
  const user = await requireReports();
  const viewId = String(formData.get("view_id") ?? "");
  if (!viewId) return;
  const admin = createAdminClient();
  const { data: view } = await admin
    .from("saved_report_views")
    .select("owner_id, name, query, shared_with, saved_report_view_teams ( team_id )")
    .eq("id", viewId)
    .maybeSingle();
  if (!view) return;
  const teamIds = ((view.saved_report_view_teams as { team_id: string }[] | null) ?? []).map((t) => t.team_id);
  if (!canSeeView({ ownerId: view.owner_id as string, sharedWith: view.shared_with as ViewSharing, teamIds }, user)) return;

  const now = new Date().toISOString();
  const { error } = await admin.from("saved_report_views").insert({
    owner_id: user.id,
    name: `${view.name as string} (copy)`.slice(0, 120),
    query: view.query,
    shared_with: "private",
    created_at: now,
    updated_at: now,
  });
  if (error) {
    await reportError({ source: "saved-report-views", error: error.message, userId: user.id });
    throw new Error("The view could not be copied. Try again.");
  }
  revalidatePath("/reports");
}
