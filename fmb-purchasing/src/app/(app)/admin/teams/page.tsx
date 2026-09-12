import { SubmitButton } from "@/components/submit-button";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeam, addTeamMember, removeTeamMember, togglePermission, setPermissionScope } from "./actions";
import { accessChangeActor, describeAccessChange, type AccessChangeRow } from "@/lib/access-changes";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Teams & permissions" };

const RECENT_CHANGES = 50;

export default async function TeamsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_teams", "manage_teams");

  const admin = createAdminClient();
  const [
    { data: teams },
    { data: pages },
    { data: actions },
    { data: grants },
    { data: profiles },
    { data: members },
    { data: changes },
  ] = await Promise.all([
      admin.from("teams").select("id, name, is_default").order("name"),
      // Only rows that are actually permission boundaries. Some app_pages
      // entries exist purely as a column-preference scope for a second view of
      // a page that is already permissioned — the expense-lines ledger inside
      // All expenses — and listing those here would offer a grant that decides
      // nothing (migration 0036).
      admin
        .from("app_pages")
        .select("key, label, sort_order")
        .eq("is_permission_scope", true)
        .order("sort_order"),
      admin.from("app_actions").select("key, label"),
      admin.from("team_permissions").select("team_id, page_key, action_key"),
      admin.from("profiles").select("id, email, full_name").order("full_name"),
      admin.from("team_members").select("team_id, user_id"),
      admin
        .from("access_changes")
        .select("id, changed_at, actor_id, kind, team_name, subject_name, page_key, action_key, detail")
        .order("changed_at", { ascending: false })
        .limit(RECENT_CHANGES),
    ]);

  const pageLabel = new Map((pages ?? []).map((p) => [p.key as string, p.label as string]));
  const actionLabel = new Map((actions ?? []).map((a) => [a.key as string, a.label as string]));
  const profileName = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  const changeRows = (changes ?? []) as AccessChangeRow[];

  const pageKeys = (pages ?? []).map((p) => p.key as string);
  const actionKeys = (actions ?? []).map((a) => a.key as string);

  const grantSet = new Set(
    (grants ?? []).map((g) => `${g.team_id}:${g.page_key}:${g.action_key}`)
  );

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="page-title text-ink">Teams & permissions</h1>
        <p className="page-description mt-1 max-w-xl">
          Create teams, assign members, and grant per-page, per-action access.
          &quot;Member&quot; is the default tier every new account starts in.
        </p>
      </div>

      <form action={createTeam} className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">New team name</span>
          <input
            name="name"
            required
            placeholder="e.g. Procurement Head"
            className="rounded-md border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-gold focus:ring-1 focus:ring-gold"
          />
        </label>
        <SubmitButton className="rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep">
          Create team
        </SubmitButton>
      </form>

      <div className="flex flex-col gap-8">
        {(teams ?? []).map((team) => {
          const teamMemberIds = new Set(
            (members ?? []).filter((m) => m.team_id === team.id).map((m) => m.user_id)
          );
          const nonMembers = (profiles ?? []).filter((p) => !teamMemberIds.has(p.id));

          // Whether a whole row or column is already granted decides what its
          // "all" toggle does: a full row offers to clear itself.
          const has = (pageKey: string, actionKey: string) => grantSet.has(`${team.id}:${pageKey}:${actionKey}`);
          const rowGranted = (pageKey: string) => actionKeys.every((a) => has(pageKey, a));
          const columnGranted = (actionKey: string) => pageKeys.every((pg) => has(pg, actionKey));

          return (
            <section key={team.id} className="rounded-lg border border-ink/10 bg-white/60 p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="section-title text-ink">{team.name}</h2>
                {team.is_default && (
                  <span className="rounded-full bg-palm/15 px-2 py-0.5 text-xs text-palm">
                    default
                  </span>
                )}
              </div>

              <div className="mb-5 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium text-ink/70">Members</h3>
                  <ul className="flex flex-col gap-1">
                    {[...teamMemberIds].map((userId) => {
                      const p = (profiles ?? []).find((pr) => pr.id === userId);
                      if (!p) return null;
                      return (
                        <li key={userId} className="flex items-center justify-between text-sm">
                          <span>{p.full_name || p.email}</span>
                          <form action={removeTeamMember}>
                            <input type="hidden" name="team_id" value={team.id} />
                            <input type="hidden" name="user_id" value={userId} />
                            <SubmitButton className="text-xs text-maroon/70 hover:text-maroon">
                              remove
                            </SubmitButton>
                          </form>
                        </li>
                      );
                    })}
                    {teamMemberIds.size === 0 && (
                      <li className="text-sm text-ink/40">No members yet.</li>
                    )}
                  </ul>

                  {nonMembers.length > 0 && (
                    <form action={addTeamMember} className="mt-3 flex items-center gap-2">
                      <input type="hidden" name="team_id" value={team.id} />
                      <select
                        name="user_id"
                        required
                        className="rounded-md border border-ink/15 bg-white px-2 py-1 text-sm"
                      >
                        {nonMembers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name || p.email}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="rounded-md bg-gold/20 px-3 py-1 text-sm text-ink hover:bg-gold/30">
                        Add
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <h3 className="mb-2 text-sm font-medium text-ink/70">Permissions</h3>
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th scope="col" className="p-1 text-left font-medium text-ink/60">Page</th>
                        {(actions ?? []).map((a) => (
                          <th scope="col" key={a.key} className="p-1 text-center font-medium text-ink/60">
                            <span className="block">{a.label}</span>
                            <ScopeToggle
                              teamId={team.id}
                              scope="column"
                              scopeKey={a.key}
                              granted={columnGranted(a.key)}
                              label={`${a.label} on every page`}
                            />
                          </th>
                        ))}
                        <th scope="col" className="p-1 text-center font-medium text-ink/60">
                          Whole page
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pages ?? []).map((page) => (
                        <tr key={page.key} className="border-t border-ink/5">
                          {/* A row header, not a cell. This is a grid of
                              checkboxes whose meaning comes entirely from the
                              intersection of its two axes: without this, a
                              screen reader announces "Approve, ticked" with no
                              way to hear which page it belongs to. */}
                          <th scope="row" className="p-1 text-left font-normal text-ink/80">
                            {page.label}
                          </th>
                          {(actions ?? []).map((a) => {
                            const granted = grantSet.has(`${team.id}:${page.key}:${a.key}`);
                            return (
                              <td key={a.key} className="p-1 text-center">
                                <form action={togglePermission}>
                                  <input type="hidden" name="team_id" value={team.id} />
                                  <input type="hidden" name="page_key" value={page.key} />
                                  <input type="hidden" name="action_key" value={a.key} />
                                  <input type="hidden" name="granted" value={String(granted)} />
                                  <SubmitButton aria-label={`${granted ? "Revoke" : "Grant"} ${a.label} on ${page.label}`} className={`h-5 w-5 rounded border ${ granted ? "border-palm bg-palm/80 text-white" : "border-ink/20 bg-white" }`}>
                                    {granted ? "✓" : ""}
                                  </SubmitButton>
                                </form>
                              </td>
                            );
                          })}
                          <td className="p-1 text-center">
                            <ScopeToggle
                              teamId={team.id}
                              scope="row"
                              scopeKey={page.key}
                              granted={rowGranted(page.key)}
                              label={`every action on ${page.label}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Access to money has a history like everything else (0045): who was
          put in which team, which grants changed, which accounts were turned
          off — including changes made in the Supabase dashboard. */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Recent changes</h2>
          <p className="mt-0.5 text-xs text-ink/55">
            The last {RECENT_CHANGES} changes to teams, members, permissions and accounts.
          </p>
        </div>
        {changeRows.length === 0 ? (
          <p className="text-sm text-ink/50">No changes recorded yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60">
            {changeRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-ink">
                  {describeAccessChange(row, {
                    page: (k) => pageLabel.get(k) ?? k,
                    action: (k) => actionLabel.get(k) ?? k,
                  })}
                  {row.detail && !row.detail.startsWith("Automatically") && (
                    <span className="text-ink/50"> · {row.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-ink/50">
                  {accessChangeActor(row, (id) => profileName.get(id))} · {formatDateTime(row.changed_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * Grants or clears a whole row or column of the grid. Says "all" when there
 * is something left to grant and "none" when the row or column is already
 * complete, so the button always names what pressing it does.
 */
function ScopeToggle({
  teamId,
  scope,
  scopeKey,
  granted,
  label,
}: {
  teamId: string;
  scope: "row" | "column";
  scopeKey: string;
  granted: boolean;
  label: string;
}) {
  return (
    <form action={setPermissionScope}>
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="key" value={scopeKey} />
      <input type="hidden" name="granted" value={String(!granted)} />
      <SubmitButton
        aria-label={`${granted ? "Revoke" : "Grant"} ${label}`}
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
          granted ? "text-maroon/70 hover:bg-maroon/10" : "text-ink/50 hover:bg-ink/5"
        }`}
      >
        {granted ? "none" : "all"}
      </SubmitButton>
    </form>
  );
}
