import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { REPORTS } from "@/lib/reporting/registry";
import { RegistryReport } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  return { title: REPORTS.find((r) => r.key === report)?.title ?? "Report" };
}

/**
 * Any report in the registry, as a page of its tables (./view). Reports with
 * a page of their own — Money out, Exceptions — are found first, since a
 * named folder beats this one; the rest are reached here.
 */
export default async function RegistryReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { report } = await params;
  const definition = REPORTS.find((r) => r.key === report);
  if (!definition) notFound();
  await requirePermission(user, definition.permission.page, definition.permission.action);
  return <RegistryReport user={user} definition={definition} params={await searchParams} />;
}
