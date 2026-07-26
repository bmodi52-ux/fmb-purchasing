import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { signOut } from "@/app/login/actions";
import { AppSidebar } from "./app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const permissions = await getUserPermissions(user.teamIds);
  const visibleNav = NAV_ITEMS.filter((item) => can(permissions, item.key, item.action));

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden md:flex-row">
      <AppSidebar navItems={visibleNav} userName={user.fullName || user.username} signOutAction={signOut} />

      <main className="min-w-0 flex-1 px-8 py-12 md:px-16">{children}</main>
    </div>
  );
}
