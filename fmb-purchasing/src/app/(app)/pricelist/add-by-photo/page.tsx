import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories } from "@/lib/categories";
import { AddByPhotoForm } from "./add-by-photo-form";

export const metadata = { title: "Add item by photo" };

// A long supplier price list is read in several pieces (#29).
export const maxDuration = 300;

export default async function AddByPhotoPage({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const { vendor } = await searchParams;
  const admin = createAdminClient();
  const [{ data: vendorRow }, { data: categories }] = await Promise.all([
    vendor
      ? admin.from("vendors").select("id, name").eq("id", vendor).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
    admin.from("categories").select("id, name, parent_category_id"),
  ]);

  const categoryNames = leafCategories(categories ?? [])
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        {vendorRow && (
          <Link href={`/vendors/${vendorRow.id}?tab=products`} className="text-sm text-ink/50 hover:text-ink">
            ← {vendorRow.name}
          </Link>
        )}
        <h1 className="page-title mt-1 text-ink">Add item by photo</h1>
        <p className="page-description mt-1 max-w-xl">
          Photograph the price tag, the product&apos;s label, or both — or a supplier&apos;s price list, or choose the
          list as a CSV or Excel file. Everything that can be read is filled in for you to check.
        </p>
      </div>
      <AddByPhotoForm
        vendor={vendorRow ? { id: vendorRow.id as string, name: vendorRow.name as string } : null}
        categories={categoryNames}
      />
    </div>
  );
}
