import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { MySubmissionsView } from "./view";

export const metadata = { title: "My submissions" };

export default async function MySubmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "my_submissions", "view");
  return <MySubmissionsView user={user} />;
}
