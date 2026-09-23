import type { SupabaseClient } from "@supabase/supabase-js";
import { progressOf, suggestPacks, type PackOption, type PackSuggestion } from "@/lib/procurement";
import type { SectionKey } from "@/lib/menu-sections";

type RequirementRow = {
  id: string;
  menu_day_id: string;
  item_id: string;
  section: SectionKey;
  quantity: number | string;
  base_unit_code: string;
  planned_cost: number | string | null;
  status: "to_order" | "ordered" | "delivered" | "cancelled";
  owner_id: string | null;
  vendor_id: string | null;
  note: string | null;
  menu_days: { service_date: string; kitchens: { name: string } | { name: string }[] | null } | null;
  items: { name: string; item_number: string | null } | { name: string; item_number: string | null }[] | null;
};

/** One thing to buy, for one day, with where it has got to. */
export type ProcurementLine = {
  id: string;
  menuDayId: string;
  serviceDate: string;
  kitchenName: string;
  section: SectionKey;
  itemId: string;
  itemName: string;
  itemNumber: string | null;
  quantity: number;
  unit: string;
  plannedCost: number | null;
  status: "to_order" | "ordered" | "delivered" | "cancelled";
  ownerId: string | null;
  ownerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** A number to ring, from the vendor's contacts, for ordering from a phone (#15). */
  vendorPhone: string | null;
  /** Days ahead the vendor needs the order; null means the day before. */
  leadDays: number | null;
  note: string | null;
  /** What to actually order, rounded to a pack the vendor sells. */
  pack: PackSuggestion | null;
  /** What has been bought against it, from the receipts already submitted. */
  bought: number;
  spent: number;
  outstanding: number;
};

/**
 * What is to be bought, for the days asked about (#70).
 *
 * Everything a procurement screen needs in one read: the requirement, who
 * holds it, what pack it comes in, and what has already been bought against
 * it.
 */
export async function loadProcurement(
  admin: SupabaseClient,
  { from, to, ownerId }: { from: string; to: string; ownerId?: string | null }
): Promise<ProcurementLine[]> {
  const query = admin
    .from("menu_requirements")
    .select(
      "id, menu_day_id, item_id, section, quantity, base_unit_code, planned_cost, status, owner_id, vendor_id, note, " +
        "menu_days!inner ( service_date, kitchen_id, kitchens ( name ) ), items ( name, item_number )"
    )
    .gte("menu_days.service_date", from)
    .lte("menu_days.service_date", to)
    .neq("status", "cancelled");

  // Typed by hand: an embedded !inner join widens the generated row type to a
  // union with an error shape, and every field below then reads as missing.
  const { data } = await (ownerId ? query.eq("owner_id", ownerId) : query);
  const rows = (data ?? []) as unknown as RequirementRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean) as string[])];

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter(Boolean) as string[])];
  const [{ data: allocations }, { data: packs }, { data: owners }, { data: vendors }, { data: contacts }] = await Promise.all([
    admin.from("expense_line_allocations").select("menu_requirement_id, quantity, amount").in("menu_requirement_id", ids),
    admin
      .from("item_pack_sizes")
      .select("id, item_id, label, total_quantity, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging")
      .in("item_id", itemIds),
    ownerIds.length
      ? admin.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    vendorIds.length
      ? admin.from("vendors").select("id, name, order_lead_days").in("id", vendorIds)
      : Promise.resolve({ data: [] }),
    vendorIds.length
      ? admin.from("vendor_contacts").select("vendor_id, phone, created_at").in("vendor_id", vendorIds).not("phone", "is", null).order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const vendorById = new Map((vendors ?? []).map((v) => [v.id as string, v]));
  const phoneOf = new Map<string, string>();
  for (const c of contacts ?? []) {
    const phone = String(c.phone ?? "").trim();
    if (phone && !phoneOf.has(c.vendor_id as string)) phoneOf.set(c.vendor_id as string, phone);
  }

  const allocationsBy = new Map<string, { quantity: number; amount: number }[]>();
  for (const a of allocations ?? []) {
    const key = a.menu_requirement_id as string;
    allocationsBy.set(key, [
      ...(allocationsBy.get(key) ?? []),
      { quantity: Number(a.quantity), amount: Number(a.amount) },
    ]);
  }

  // Loose packs are left out: something sold by weight needs no rounding, and
  // "150 × loose" is not an instruction anybody can follow.
  const packsBy = new Map<string, PackOption[]>();
  for (const p of (packs ?? []).filter((p) => !p.sold_loose)) {
    const key = p.item_id as string;
    packsBy.set(key, [
      ...(packsBy.get(key) ?? []),
      {
        packSizeId: p.id as string,
        title: (p.label as string | null) ?? describe(p),
        totalQuantity: Number(p.total_quantity ?? 0),
      },
    ]);
  }

  const ownerName = new Map((owners ?? []).map((o) => [o.id as string, (o.full_name || o.email) as string]));

  return rows
    .map((row) => {
      const day = row.menu_days;
      const kitchen = one(day?.kitchens);
      const item = one(row.items);
      const quantity = Number(row.quantity);
      const progress = progressOf({ quantity }, allocationsBy.get(row.id) ?? []);

      return {
        id: row.id,
        menuDayId: row.menu_day_id,
        serviceDate: day?.service_date ?? "",
        kitchenName: kitchen?.name ?? "",
        section: row.section,
        itemId: row.item_id,
        itemName: item?.name ?? "Item",
        itemNumber: item?.item_number ?? null,
        quantity,
        unit: row.base_unit_code,
        plannedCost: row.planned_cost == null ? null : Number(row.planned_cost),
        status: row.status,
        ownerId: row.owner_id,
        ownerName: row.owner_id ? (ownerName.get(row.owner_id) ?? null) : null,
        vendorId: row.vendor_id,
        vendorName: row.vendor_id ? ((vendorById.get(row.vendor_id)?.name as string | undefined) ?? null) : null,
        vendorPhone: row.vendor_id ? (phoneOf.get(row.vendor_id) ?? null) : null,
        leadDays: row.vendor_id ? ((vendorById.get(row.vendor_id)?.order_lead_days as number | null | undefined) ?? null) : null,
        note: row.note,
        pack: suggestPacks(progress.outstanding > 0 ? progress.outstanding : quantity, packsBy.get(row.item_id) ?? []),
        bought: progress.bought,
        spent: progress.spent,
        outstanding: progress.outstanding,
      };
    })
    .sort(
      (a, b) =>
        a.serviceDate.localeCompare(b.serviceDate) ||
        a.kitchenName.localeCompare(b.kitchenName) ||
        a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" })
    );
}

/** A pack with no name of its own, said the way the rest of the app says it. */
function describe(p: Record<string, unknown>): string {
  const count = Number(p.pack_count ?? 1);
  const inner = Number(p.inner_quantity ?? 1);
  if (p.sold_loose) return "loose";
  const container = typeof p.packaging === "string" && p.packaging ? p.packaging : "pack";
  return count > 1 ? `${container} of ${count} × ${inner}` : `${container} of ${inner}`;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
