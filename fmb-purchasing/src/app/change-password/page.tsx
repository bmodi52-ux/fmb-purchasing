import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "@/app/login/actions";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Deliberately outside the (app) route group: that layout redirects here
 * while must_change_password is set, so this page must not be behind it.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AuthCard
      title={user.mustChangePassword ? "Choose a password" : "Change password"}
      subtitle={
        user.mustChangePassword
          ? "Your temporary password needs replacing before you continue."
          : `Signed in as ${user.email}`
      }
    >
      <ChangePasswordForm forced={user.mustChangePassword} />

      {/* The forced variant has no Cancel — without this there'd be no way
          out of the page short of clearing cookies. */}
      {user.mustChangePassword && (
        <form action={signOut} className="mt-4 text-center">
          <button type="submit" className="text-sm text-ink/60 underline hover:text-ink">
            Sign out instead
          </button>
        </form>
      )}
    </AuthCard>
  );
}
