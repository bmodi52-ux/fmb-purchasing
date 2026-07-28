import { getCurrentUser } from "@/lib/auth/session";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title text-ink">
        Welcome, {user?.fullName || user?.username}
      </h1>
      <p className="max-w-xl text-ink/70">
        Use the sidebar to submit an expense or, if you have access, review
        submissions, master data, and reports.
      </p>
    </div>
  );
}
