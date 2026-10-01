import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { BudgetsReport } from "./view";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "view");
  return <BudgetsReport user={user} params={await searchParams} />;
}
