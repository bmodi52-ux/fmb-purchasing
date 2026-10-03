import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { MenuCalendarView } from "./view";

export const metadata = { title: "Thaali Calendar" };

export default async function MenuCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kitchens?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");
  const { month, kitchens } = await searchParams;
  return <MenuCalendarView user={user} month={month} kitchens={kitchens} />;
}
