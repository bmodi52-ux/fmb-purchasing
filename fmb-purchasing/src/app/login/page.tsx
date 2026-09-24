import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthCard title="Sign in" subtitle="Use the email your account was set up with.">
      <LoginForm />
    </AuthCard>
  );
}
