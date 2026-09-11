import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitForm } from "./submit-form";
import { getExpenseForEdit, getExpenseForResubmit } from "./actions";
import { leafCategories } from "@/lib/categories";

export const metadata = { title: "Submit expense" };

export default async function SubmitExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; resubmit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const { edit, resubmit } = await searchParams;
  const editExpense = edit ? await getExpenseForEdit(edit) : null;
  const resubmitFrom = !editExpense && resubmit ? await getExpenseForResubmit(resubmit) : null;

  const admin = createAdminClient();
  const [{ data: categories }, { data: vendors }] = await Promise.all([
    admin
      .from("categories")
      .select("id, name, parent_category_id, applies_to")
      .order("name"),
    admin.from("vendors").select("id, name").eq("status", "approved").order("name"),
  ]);

  // Sorted by the name shown rather than by hierarchy: this picker lists bare
  // leaf names, so grouping Beef and Chicken at their parent's place in the
  // alphabet would read as no order at all. Each carries the line kinds it is
  // usually filed under, which decides the order they are offered in.
  const categoryOptions = leafCategories(categories ?? [])
    .map((c) => ({ name: c.name, appliesTo: c.applies_to ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">
          {editExpense ? "Edit expense" : resubmitFrom ? "Resubmit expense" : "Submit expense"}
        </h1>
        <p className="page-description mt-1 max-w-xl">
          {editExpense
            ? "You can edit this until it's approved or declined."
            : resubmitFrom
              ? `A copy of ${resubmitFrom.sourceNumber ?? "your earlier expense"}. Fix what's needed and submit — the original stays on record.`
              : "Upload a receipt for AI extraction, or enter the details manually. A receipt is never required."}
        </p>
      </div>
      <SubmitForm
        categories={categoryOptions}
        vendorNames={(vendors ?? []).map((v) => v.name)}
        myName={user.fullName || user.email}
        editExpense={editExpense}
        resubmitFrom={resubmitFrom}
      />
    </div>
  );
}
