import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";

export type LiveAllocation = { menu_requirement_id: string; quantity: number; amount: number };

/**
 * What receipts have been allocated to these menu requirements (0063) — only
 * from receipts that still count as spend.
 *
 * Declining or withdrawing an expense leaves its allocations in place, and
 * they used to be read as they stood: a declined receipt still showed as money
 * spent on the Thaali costs page, still marked its items bought on the day and
 * on the shopping lists, and still filled the requirement so the replacement
 * receipt found nothing left to match. Filtering here, through the line to its
 * expense, rather than deleting on decline keeps the record: reopening a
 * decision brings the allocation back with it.
 */
export async function liveAllocations(admin: SupabaseClient, requirementIds: string[]): Promise<LiveAllocation[]> {
  if (requirementIds.length === 0) return [];
  const { data, error } = await admin
    .from("expense_line_allocations")
    .select("menu_requirement_id, quantity, amount, expense_line_items!inner ( expenses!inner ( status ) )")
    .in("menu_requirement_id", requirementIds)
    .not("expense_line_items.expenses.status", "in", NOT_SPEND_FILTER);
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    menu_requirement_id: a.menu_requirement_id as string,
    quantity: Number(a.quantity),
    amount: Number(a.amount),
  }));
}
