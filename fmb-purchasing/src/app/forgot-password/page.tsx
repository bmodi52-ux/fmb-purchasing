import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgotten password"
      subtitle="We'll email you a link to set a new one"
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
