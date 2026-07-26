import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CurrentUser = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  teamIds: string[];
};

/**
 * The signed-in user's profile + team memberships, or null if not signed in.
 * Reads via the admin client because authorization is enforced in app code
 * (against team_permissions), not RLS — see migration 0001.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, full_name, email, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  const { data: memberships } = await admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    email: profile.email,
    teamIds: (memberships ?? []).map((m) => m.team_id),
  };
}
