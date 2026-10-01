import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { SpendingReport } from "./view";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");
  return <SpendingReport user={user} params={await searchParams} />;
}
