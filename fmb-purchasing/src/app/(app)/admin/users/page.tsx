import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { CreateUserForm } from "./create-user-form";
import { UsersTable, type UserRow } from "./users-table";

const PAGE_KEY = "admin_users";
const DEFAULT_VISIBLE = ["username", "full_name", "email", "teams", "status", "actions"];

export default async function UsersAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");

  const admin = createAdminClient();
  const [{ data: profiles }, { data: teams }, { data: members }, visibleColumns] = await Promise.all([
    admin.from("profiles").select("id, username, full_name, email, is_active").order("username"),
    admin.from("teams").select("id, name"),
    admin.from("team_members").select("team_id, user_id"),
    getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
  ]);

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const rows: UserRow[] = (profiles ?? []).map((p) => {
    const teamNames = (members ?? [])
      .filter((m) => m.user_id === p.id)
      .map((m) => teamNameById.get(m.team_id))
      .filter(Boolean)
      .join(", ");
    return {
      id: p.id,
      username: p.username,
      full_name: p.full_name,
      email: p.email,
      teamNames,
      is_active: p.is_active,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">Users</h1>
        <p className="page-description mt-1 max-w-xl">
          Manual username/password accounts. Every new account starts in the
          default &quot;Member&quot; team; assign additional teams from{" "}
          <a href="/admin/teams" className="underline">
            Teams & permissions
          </a>
          .
        </p>
      </div>

      <CreateUserForm />

      <UsersTable rows={rows} initialVisible={visibleColumns} />
    </div>
  );
}
