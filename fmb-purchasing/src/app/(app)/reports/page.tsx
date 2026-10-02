import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { isSpendingAddress } from "@/lib/reporting/dashboard";
import { SPENDING_PATH } from "@/lib/reporting/query";
import { ReportsDashboard } from "./dashboard";

export const metadata = { title: "Reports" };

/**
 * The Reports dashboard. The Spending report had this address before, so a
 * link, bookmark or saved view that names a section or a filter — which only
 * that report reads — is sent on to it with everything it carried.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const params = await searchParams;
  if (isSpendingAddress(params)) {
    const carried = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) carried.append(key, v);
    }
    redirect(`${SPENDING_PATH}?${carried}`);
  }

  return <ReportsDashboard user={user} params={params} />;
}
