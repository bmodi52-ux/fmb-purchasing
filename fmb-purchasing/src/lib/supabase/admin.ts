import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS — only call from trusted
 * server code (Server Actions / Route Handlers), never expose to the
 * client. Used for admin operations (creating users, etc.) and for the
 * app's own data access, since authorization is enforced in application
 * code against team_permissions rather than via RLS (see migration 0001).
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
