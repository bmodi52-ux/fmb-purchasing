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

  // `getClaims()` verifies the access token's signature locally against a
  // cached JWKS (once the project is on asymmetric signing keys), so
  // establishing who is asking costs no network round trip. It falls back to
  // an Auth server call on projects still using the legacy symmetric secret,
  // which is what `getUser()` did unconditionally.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (!userId) return null;

  const admin = createAdminClient();

  // Team memberships ride along as an embed rather than costing a second
  // sequential round trip — every authenticated page load waits on this.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, email, is_active, must_change_password, team_members ( team_id )")
    .eq("id", userId)
    .single();

  if (!profile || !profile.is_active) return null;

  const memberships = (profile.team_members ?? []) as { team_id: string }[];

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    mustChangePassword: profile.must_change_password,
    teamIds: memberships.map((m) => m.team_id),
  };
});
