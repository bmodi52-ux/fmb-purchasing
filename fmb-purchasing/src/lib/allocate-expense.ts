import type { SupabaseClient } from "@supabase/supabase-js";
import { proposeAllocations, type AllocatableLine, type OpenRequirement } from "@/lib/procurement";

/**
 * Tie a submitted expense back to the days it was bought for (#70, piece four).
 *
 * A receipt belongs to no day — it arrives late, or early, or covers several
 * at once — so its lines are matched against what those days still need:
 * same item, earliest day first, within a window either side of the receipt.
 * What matches is recorded; what doesn't is simply left, and shows up as a
 * day whose requirement nothing has been bought against.
 *
 * Nothing here blocks a submission. An expense is a fact whether or not it
 * lines up with a plan, and a wrong guess is worse than no guess — which is
 * why only the arithmetic is automatic and the record it writes can be
 * corrected.
 */

/** Days either side of the receipt that a purchase might have been for. */
const WINDOW_DAYS = 7;

export async function allocateExpenseToMenus(
  admin: SupabaseClient,
  {
    expenseId,
    receiptDate,
    userId,
  }: { expenseId: string; receiptDate: string | null; userId: string | null }
): Promise<number> {
  const around = receiptDate ?? new Date().toISOString().slice(0, 10);
  const from = shiftDays(around, -WINDOW_DAYS);
  const to = shiftDays(around, WINDOW_DAYS);

  const { data: lineRows } = await admin
    .from("expense_line_items")
    .select("id, kind, line_total, normalized_quantity, pricelist_item_id")
    .eq("expense_id", expenseId)
    .eq("kind", "goods");
  if (!lineRows || lineRows.length === 0) return 0;

  // A line knows its offer; the item is a pack size away.
  const offerIds = [...new Set(lineRows.map((l) => l.pricelist_item_id).filter(Boolean) as string[])];
  if (offerIds.length === 0) return 0;

  const { data: offers } = await admin
    .from("pricelist_items")
    .select("id, item_pack_sizes ( item_id )")
    .in("id", offerIds);
  const itemByOffer = new Map<string, string>();
  for (const offer of offers ?? []) {
    const pack = Array.isArray(offer.item_pack_sizes) ? offer.item_pack_sizes[0] : offer.item_pack_sizes;
    const itemId = (pack as { item_id?: string } | null)?.item_id;
    if (itemId) itemByOffer.set(offer.id as string, itemId);
  }

  const lines: AllocatableLine[] = lineRows.flatMap((row) => {
    const itemId = row.pricelist_item_id ? itemByOffer.get(row.pricelist_item_id as string) : undefined;
    if (!itemId) return [];
    return [
      {
        lineItemId: row.id as string,
        itemId,
        quantity: row.normalized_quantity == null ? null : Number(row.normalized_quantity),
        lineTotal: Number(row.line_total),
      },
    ];
  });
  if (lines.length === 0) return 0;

  const { data: requirementRows } = await admin
    .from("menu_requirements")
    .select("id, item_id, quantity, menu_days!inner ( service_date )")
    .in("item_id", [...new Set(lines.map((l) => l.itemId))])
    .neq("status", "cancelled")
    .gte("menu_days.service_date", from)
    .lte("menu_days.service_date", to);
  if (!requirementRows || requirementRows.length === 0) return 0;

  const ids = requirementRows.map((r) => r.id as string);
  const { data: already } = await admin
    .from("expense_line_allocations")
    .select("menu_requirement_id, quantity")
    .in("menu_requirement_id", ids);
  const allocated = new Map<string, number>();
  for (const row of already ?? []) {
    const key = row.menu_requirement_id as string;
    allocated.set(key, (allocated.get(key) ?? 0) + Number(row.quantity));
  }

  const open: OpenRequirement[] = requirementRows.map((row) => {
    const day = Array.isArray(row.menu_days) ? row.menu_days[0] : row.menu_days;
    return {
      requirementId: row.id as string,
      itemId: row.item_id as string,
      serviceDate: (day as { service_date?: string } | null)?.service_date ?? "",
      quantity: Number(row.quantity),
      allocated: allocated.get(row.id as string) ?? 0,
    };
  });

  const proposals = proposeAllocations(lines, open);
  if (proposals.length === 0) return 0;

  const { error } = await admin.from("expense_line_allocations").upsert(
    proposals.map((p) => ({
      expense_line_item_id: p.lineItemId,
      menu_requirement_id: p.requirementId,
      quantity: p.quantity,
      amount: p.amount,
      source: "matched",
      created_by: userId,
    })),
    { onConflict: "expense_line_item_id,menu_requirement_id" }
  );
  if (error) throw error;

  return proposals.length;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
