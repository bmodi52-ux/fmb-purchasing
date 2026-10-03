import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ItemDetailView, type ItemTab } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient()
    .from("items")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (data?.name as string | null) ?? "Item" };
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  const tab: ItemTab =
    tabParam === "purchases" || tabParam === "settings" || tabParam === "history" ? tabParam : "overview";

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "view");

  return <ItemDetailView user={user} id={id} tab={tab} />;
}
