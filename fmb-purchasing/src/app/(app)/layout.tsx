import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { NAV_ITEMS } from "@/lib/nav";
import { signOut } from "@/app/login/actions";
import { AppSidebar } from "./app-sidebar";
import { PendingProvider } from "@/components/pending";
import { unreadCount } from "@/lib/notifications-inapp";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // An admin-issued temporary password gets someone in the door and no
  // further. /change-password sits outside this layout, so this can't loop.
  if (user.mustChangePassword) redirect("/change-password");

  // Both are per-request cached, and the count is a single indexed COUNT, so
  // running it alongside the permission fetch costs one extra round trip.
  const [permissions, unread] = await Promise.all([
    getUserPermissions(user.teamIds),
    unreadCount(user.id),
  ]);
  const visibleNav = NAV_ITEMS.filter((item) => can(permissions, item.key, item.action));

  return (
    <PendingProvider>
      <div className="flex min-h-screen flex-col overflow-x-hidden md:flex-row">
        <AppSidebar
          navItems={visibleNav}
          userName={user.fullName || user.email}
          signOutAction={signOut}
          unreadCount={unread}
        />

        <main className="min-w-0 flex-1 px-8 py-12 md:px-16">{children}</main>
      </div>
    </PendingProvider>
  );
}
