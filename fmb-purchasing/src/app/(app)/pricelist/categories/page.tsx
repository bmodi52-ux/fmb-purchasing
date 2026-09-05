import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { CategoriesManager, type ManagedCategory } from "../categories-manager";

/**
 * Its own page rather than a disclosure on the Pricelist: since 0024 a
 * category's code is the prefix on every item number filed under it, so this
 * is master data now, not a setting. Nineteen rows of it also pushed the
 * offers table off the screen.
 *
 * Reuses the pricelist page key rather than adding one nobody has been
 * granted — the same reasoning as the System errors entry in lib/nav.ts.
 * edit_master_data, not view: there is nothing here to read passively.
 */
export default async function PricelistCategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "edit_master_data");

  const admin = createAdminClient();
  const [{ data: categories }, { data: itemCategoryRows }] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id, code").order("sort_order"),
    // Every item, not just those with an offer, so the "changing the code
    // renumbers N items" warning is honest.
    admin.from("items").select("category_id"),
  ]);

  const itemCountByCategory = new Map<string, number>();
  for (const row of itemCategoryRows ?? []) {
    if (row.category_id) {
      itemCountByCategory.set(row.category_id, (itemCountByCategory.get(row.category_id) ?? 0) + 1);
    }
  }

  const managedCategories: ManagedCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code ?? null,
    parentCategoryId: c.parent_category_id,
    itemCount: itemCountByCategory.get(c.id) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/pricelist" className="text-sm text-ink/50 hover:text-ink">
          ← Pricelist
        </Link>
        <h1 className="page-title mt-1 text-ink">Categories</h1>
        <p className="page-description mt-1 max-w-2xl">
          Categories classify every item, and a category&rsquo;s code is the prefix on
          the item numbers filed under it — an item in Chicken reads CHK-0042.
          Subcategories without their own code borrow their parent&rsquo;s.
        </p>
      </div>

      <CategoriesManager categories={managedCategories} />
    </div>
  );
}
