import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { UnitsManager, type ManagedUnit } from "../units-manager";

export const metadata = { title: "Units" };

export default async function PricelistUnitsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "edit_master_data");

  const admin = createAdminClient();
  const { data: units } = await admin
    .from("units")
    .select("id, code, label, dimension, base_unit_code, to_base_factor")
    .order("dimension")
    .order("sort_order");

  const managedUnits: ManagedUnit[] = (units ?? []).map((u) => ({
    id: u.id,
    code: u.code,
    label: u.label,
    dimension: u.dimension,
    baseUnitCode: u.base_unit_code,
    toBaseFactor: Number(u.to_base_factor),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/pricelist" className="text-sm text-ink/50 hover:text-ink">
          ← Pricelist
        </Link>
        <h1 className="page-title mt-1 text-ink">Units</h1>
        <p className="page-description mt-1 max-w-2xl">
          The units pack sizes are measured in. Each carries a dimension and a
          factor for converting to a base unit, which is what lets a 500 g pack
          and a 1 kg pack be compared on cost rather than reported as
          &ldquo;0.01/g&rdquo; and &ldquo;9/kg&rdquo;.
        </p>
      </div>

      <UnitsManager units={managedUnits} />
    </div>
  );
}
