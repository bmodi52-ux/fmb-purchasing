import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmissionsList } from "./submissions-list";

export default async function MySubmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "my_submissions", "view");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select(
      "id, vendor_name_raw, invoice_number, total, status, decision_comment, decided_at, payment_reference, payment_date, created_at"
    )
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink">My submissions</h1>
        <p className="mt-1 text-ink/70">Track the status of expenses you&apos;ve submitted.</p>
      </div>

      <SubmissionsList expenses={expenses ?? []} />
    </div>
  );
}
