import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlainDate } from "@/lib/format";
import { SECTIONS, SECTION_LABEL } from "@/lib/menu-sections";
import { loadProcurement } from "../data";
import { ProcurementTabs } from "../tabs";
import { ShoppingLists } from "./shopping-lists";

export const metadata = { title: "Shopping lists" };

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  const today = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam ?? "") ? fromParam! : isoDate(today);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toParam ?? "")
    ? toParam!
    : isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));

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

      <form action="/procurement/lists" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <button type="submit" className="rounded-md border border-ink/15 px-4 py-2 hover:border-ink/30">
          Show
        </button>
      </form>

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
