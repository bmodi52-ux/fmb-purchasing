import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitForm } from "./submit-form";
import { getExpenseForEdit } from "./actions";
import { leafCategories } from "@/lib/categories";

export default async function SubmitExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const { edit } = await searchParams;
  const editExpense = edit ? await getExpenseForEdit(edit) : null;

  const admin = createAdminClient();
  const [{ data: categories }, { data: vendors }] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
    admin.from("vendors").select("id, name").eq("status", "approved").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">
          {editExpense ? "Edit expense" : "Submit expense"}
        </h1>
        <p className="mt-1 max-w-xl text-ink/70">
          {editExpense
            ? "You can edit this until it's approved or declined."
            : "Upload a receipt for AI extraction, or enter the details manually. A receipt is never required."}
        </p>
      </div>
      <SubmitForm
        categories={leafCategories(categories ?? []).map((c) => c.name)}
        vendorNames={(vendors ?? []).map((v) => v.name)}
        editExpense={editExpense}
      />
    </div>
  );
}
