import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { SpendingReport } from "../view";

export const metadata = { title: "Spending" };

/**
 * The Spending report. It was the whole of /reports until the dashboard took
 * that address; links to the old one with a section or a filter are sent
 * here (reports/page.tsx).
 */
export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");
  return <SpendingReport user={user} params={await searchParams} />;
}
