import { SubmitButton } from "@/components/submit-button";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeam, addTeamMember, removeTeamMember, togglePermission } from "./actions";

export default async function TeamsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_teams", "manage_teams");

  const admin = createAdminClient();
  const [{ data: teams }, { data: pages }, { data: actions }, { data: grants }, { data: profiles }, { data: members }] =
    await Promise.all([
      admin.from("teams").select("id, name, is_default").order("name"),
      admin.from("app_pages").select("key, label, sort_order").order("sort_order"),
      admin.from("app_actions").select("key, label"),
      admin.from("team_permissions").select("team_id, page_key, action_key"),
      admin.from("profiles").select("id, username, full_name").order("username"),
      admin.from("team_members").select("team_id, user_id"),
    ]);

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
                          <span>{p.full_name || p.username}</span>
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
                            {p.full_name || p.username}
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
                        <th className="p-1 text-left font-medium text-ink/60">Page</th>
                        {(actions ?? []).map((a) => (
                          <th key={a.key} className="p-1 text-center font-medium text-ink/60">
                            {a.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(pages ?? []).map((page) => (
                        <tr key={page.key} className="border-t border-ink/5">
                          <td className="p-1 text-ink/80">{page.label}</td>
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
    </div>
  );
}
