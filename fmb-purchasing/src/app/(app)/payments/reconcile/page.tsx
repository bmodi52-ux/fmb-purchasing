import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReconcileForm } from "./reconcile-form";

export const metadata = { title: "Check against a bank statement" };

/**
 * Confirming that "paid" means paid (#37): a statement from internet banking,
 * matched against the transfers recorded here.
 */
export default async function ReconcilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const { count } = await createAdminClient()
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("status", "paid")
    .is("bank_confirmed_on", null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payments" className="text-sm text-ink/50 hover:text-ink">
          ← Payments
        </Link>
        <h1 className="page-title mt-1 text-ink">Check against a bank statement</h1>
        <p className="page-description mt-1 max-w-2xl">
          Marking an expense paid records that someone made the transfer. The statement is the bank saying it went.
          Upload one to confirm the payments on it, and to see any recorded as paid that never left the account.{" "}
          {count ? `${count} paid ${count === 1 ? "expense hasn't" : "expenses haven't"} been confirmed yet.` : "Every paid expense is confirmed."}
        </p>
      </div>
      <ReconcileForm />
    </div>
  );
}
