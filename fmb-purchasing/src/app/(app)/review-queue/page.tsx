import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { ReviewQueueView } from "./view";

export const metadata = { title: "Needs attention" };

export default async function ReviewQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "review_queue", "view");
  return <ReviewQueueView />;
}
