import { AuthCard } from "@/components/auth-card";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard title="Reset password" subtitle="This link is incomplete">
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-ink/80">
            The link you followed is missing its reset code. Some email clients
            shorten long links — try copying the whole address, or request a new one.
          </p>
          <a
            href="/forgot-password"
            className="rounded-md bg-gold px-4 py-2 text-center font-medium text-ink transition-colors hover:bg-gold-deep"
          >
            Request a new link
          </a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a password" subtitle="Set a new password for your account">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
