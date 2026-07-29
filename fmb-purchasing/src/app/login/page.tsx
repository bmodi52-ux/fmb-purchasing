import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthCard title="FMB Sydney" subtitle="Sign in to continue">
      <LoginForm />
    </AuthCard>
  );
}
