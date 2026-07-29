import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CurrentUser = {
  id: string;
  fullName: string;
  /** Login identity and notification address — see migration 0017. */
  email: string;
  mustChangePassword: boolean;
  teamIds: string[];
};

/**
 * The signed-in user's profile + team memberships, or null if not signed in.
 * Reads via the admin client because authorization is enforced in app code
 * (against team_permissions), not RLS — see migration 0001.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, email, is_active, must_change_password")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  const { data: memberships } = await admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    mustChangePassword: profile.must_change_password,
    teamIds: (memberships ?? []).map((m) => m.team_id),
  };
});
