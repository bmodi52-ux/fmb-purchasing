"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

/**
 * Sets or clears one category's budget for one fiscal year.
 *
 * A blank amount deletes the row rather than storing zero. The two mean
 * different things and the difference shows on the page: no budget means "we
 * have not decided", zero means "we have decided to spend nothing here", and
 * a category with no budget should not be reported as 100% over on its first
 * purchase.
 */
export async function setCategoryBudget(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "edit_master_data");

  const categoryId = String(formData.get("category_id") ?? "");
  const fiscalYear = Number(formData.get("fiscal_year") ?? 0);
  const raw = String(formData.get("amount") ?? "").trim();
  if (!categoryId || !fiscalYear) return;

  const admin = createAdminClient();

  if (raw === "") {
    await admin
      .from("category_budgets")
      .delete()
      .eq("category_id", categoryId)
      .eq("fiscal_year_hijri", fiscalYear);
    revalidatePath("/budgets");
    return;
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return;

  await admin.from("category_budgets").upsert(
    {
      category_id: categoryId,
      fiscal_year_hijri: fiscalYear,
      amount,
      set_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "category_id,fiscal_year_hijri" }
  );

  revalidatePath("/budgets");
}

/**
 * Copies last year's budgets forward as a starting point.
 *
 * Setting eighteen categories from scratch every Shawwal is the kind of chore
 * that means budgets get set once and then never again. Existing rows for the
 * target year are left alone, so this is safe to run twice and cannot
 * overwrite a figure someone has already thought about.
 */
export async function copyBudgetsFromPreviousYear(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "edit_master_data");

  const fiscalYear = Number(formData.get("fiscal_year") ?? 0);
  if (!fiscalYear) return;

  const admin = createAdminClient();
  const [{ data: previous }, { data: existing }] = await Promise.all([
    admin
      .from("category_budgets")
      .select("category_id, amount")
      .eq("fiscal_year_hijri", fiscalYear - 1),
    admin.from("category_budgets").select("category_id").eq("fiscal_year_hijri", fiscalYear),
  ]);

  const alreadySet = new Set((existing ?? []).map((r) => r.category_id as string));
  const rows = (previous ?? [])
    .filter((r) => !alreadySet.has(r.category_id as string))
    .map((r) => ({
      category_id: r.category_id,
      fiscal_year_hijri: fiscalYear,
      amount: r.amount,
      set_by: user.id,
    }));

  if (rows.length > 0) await admin.from("category_budgets").insert(rows);
  revalidatePath("/budgets");
}
