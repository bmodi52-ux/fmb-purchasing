import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlainDate } from "@/lib/format";
import { SECTIONS, SECTION_LABEL } from "@/lib/menu-sections";
import { isoDate, rangeFromParams } from "@/lib/buying-week";
import { loadProcurement } from "../data";
import { WeekPicker } from "../week-picker";
import { ProcurementTabs } from "../tabs";
import { ShoppingLists } from "./shopping-lists";

export const metadata = { title: "Shopping lists" };

/**
 * The list you take shopping (#70, piece two).
 *
 * Several days are bought for in one trip, so the list adds them up: one
 * Meat list for Friday, Monday and Wednesday together, with the quantities
 * summed per item and each day's share still shown, because the butcher
 * needs the total and the kitchen needs to know what it was for.
 */
export default async function ShoppingListsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "view");
  const canManage = can(await getUserPermissions(user), "procurement", "manage");

  const { from: fromParam, to: toParam } = await searchParams;
  const today = isoDate(new Date());
  const { from, to } = rangeFromParams({ from: fromParam, to: toParam }, today);

  const admin = createAdminClient();
  const lines = await loadProcurement(admin, { from, to });

  const vendorIds = [...new Set(lines.map((l) => l.vendorId).filter(Boolean) as string[])];
  const { data: vendors } = vendorIds.length
    ? await admin.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendorName = new Map((vendors ?? []).map((v) => [v.id as string, v.name as string]));

  const days = [...new Set(lines.map((l) => l.serviceDate))].sort();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Procurement</h1>
        <p className="page-description mt-1 max-w-2xl">
          Pick the days you are buying for and the lists you want. Quantities add up across the days, and each list can
          be printed or downloaded.
        </p>
      </div>

      <ProcurementTabs active="lists" canManage={canManage} />

      <WeekPicker action="/procurement/lists" range={{ from, to }} today={today} />

      {lines.length === 0 ? (
        <p className="text-sm text-ink/55">
          Nothing released between {formatPlainDate(from)} and {formatPlainDate(to)}. A day&apos;s menu has to be
          released before it becomes something to buy.
        </p>
      ) : (
        <ShoppingLists
          lines={lines.map((l) => ({
            id: l.id,
            serviceDate: l.serviceDate,
            kitchenName: l.kitchenName,
            section: l.section,
            itemId: l.itemId,
            itemName: l.itemName,
            quantity: l.quantity,
            outstanding: l.outstanding,
            unit: l.unit,
            packTitle: l.pack?.title ?? null,
            packs: l.pack?.packs ?? null,
            vendorName: l.vendorId ? (vendorName.get(l.vendorId) ?? null) : null,
            status: l.status,
          }))}
          days={days}
          sections={SECTIONS.map((s) => ({ key: s, label: SECTION_LABEL[s] }))}
        />
      )}
    </div>
  );
}
