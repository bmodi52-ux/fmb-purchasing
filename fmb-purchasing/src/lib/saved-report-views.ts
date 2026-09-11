import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportQuery } from "@/app/(app)/reports/report-filters";

/**
 * Saved report views (#41, migration 0053): a report's period, filters and
 * section under a name. Its owner keeps it, shares it with everyone who can
 * see Reports, or with chosen teams; anyone it is shared with can open it or
 * copy it, and only the owner changes or deletes it.
 */

export type ViewSharing = "private" | "reports" | "teams";

export const SHARING_LABELS: Record<ViewSharing, string> = {
  private: "Only me",
  reports: "Everyone who can see Reports",
  teams: "Chosen teams",
};

export type SavedReportView = {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  query: ReportQuery;
  sharedWith: ViewSharing;
  teamIds: string[];
  updatedAt: string;
};

/** Whether someone may open a view. Reports access itself is checked by the page. */
export function canSeeView(
  view: { ownerId: string; sharedWith: ViewSharing; teamIds: string[] },
  user: { id: string; teamIds: string[] }
): boolean {
  if (view.ownerId === user.id) return true;
  if (view.sharedWith === "reports") return true;
  if (view.sharedWith === "teams") return view.teamIds.some((t) => user.teamIds.includes(t));
  return false;
}

/** Own views first, then shared ones, each by name. */
export function sortViews<T extends { ownerId: string; name: string }>(views: T[], userId: string): T[] {
  return [...views].sort(
    (a, b) =>
      Number(b.ownerId === userId) - Number(a.ownerId === userId) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  );
}

export async function loadSavedViews(
  admin: SupabaseClient,
  user: { id: string; teamIds: string[] }
): Promise<SavedReportView[]> {
  const { data: rows, error } = await admin
    .from("saved_report_views")
    .select("id, owner_id, name, query, shared_with, updated_at, saved_report_view_teams ( team_id )")
    .or(`owner_id.eq.${user.id},shared_with.in.(reports,teams)`)
    .order("name");
  if (error || !rows?.length) return [];

  const views = rows.map((r) => ({
    id: r.id as string,
    ownerId: r.owner_id as string,
    ownerName: "",
    name: r.name as string,
    query: r.query as ReportQuery,
    sharedWith: r.shared_with as ViewSharing,
    teamIds: ((r.saved_report_view_teams as { team_id: string }[] | null) ?? []).map((t) => t.team_id),
    updatedAt: r.updated_at as string,
  }));
  const visible = views.filter((v) => canSeeView(v, user));

  const ownerIds = [...new Set(visible.map((v) => v.ownerId))];
  const { data: owners } = ownerIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", ownerIds)
    : { data: [] };
  const nameOf = new Map((owners ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  return sortViews(
    visible.map((v) => ({ ...v, ownerName: nameOf.get(v.ownerId) ?? "someone" })),
    user.id
  );
}
