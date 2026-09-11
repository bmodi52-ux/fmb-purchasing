import { createAdminClient } from "@/lib/supabase/admin";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import { categoryLabelsById } from "@/lib/categories";
import { describePack } from "@/lib/pack-description";

/**
 * Everything currently waiting on a person's judgement, in one place.
 *
 * These questions were each visible somewhere — an uncategorised item on the
 * Pricelist, a pending vendor on Vendors, a line the model could not classify
 * buried in an expense — but never together, and never as a list you could
 * work through and finish. So nothing was anyone's job, and the answer to
 * "is there anything outstanding?" required opening four pages and knowing
 * what to look for on each.
 *
 * The receipts make this busier than it sounds. A large share of them identify
 * a line only as "OPEN ITEM", "GROCERY ITEM" or "OPEN FRESH MEAT", with the
 * real product handwritten beside it — so unclassifiable lines are the normal
 * case here, not an edge one.
 */

export type QueueItemKind =
  | "unallocated_line"
  | "uncategorised_line"
  | "pending_vendor"
  | "pending_item"
  | "unconfirmed_pack";

export type QueueItem = {
  kind: QueueItemKind;
  id: string;
  title: string;
  detail: string;
  href: string;
  /** Sorts the list: money at risk first, then things that block reporting. */
  weight: number;
  amount: number | null;
};

export type ReviewQueue = {
  items: QueueItem[];
  counts: Record<QueueItemKind, number>;
};

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export async function loadReviewQueue(): Promise<ReviewQueue> {
  const admin = createAdminClient();

  const [
    { data: unallocated },
    { data: uncategorised },
    { data: vendors },
    { data: offers },
    { data: packs },
    { data: categoryRows },
    { data: units },
  ] = await Promise.all([
    // Money recorded against an expense that nobody has said what it was for.
    // Top of the list: it is the only entry here that represents spend with no
    // explanation attached.
    admin
      .from("expense_line_items")
      .select("id, expense_id, description_raw, line_total, expenses!inner ( expense_number, status, vendor_name_raw )")
      .eq("kind", "unallocated")
      .not("expenses.status", "in", NOT_SPEND_FILTER)
      .limit(100),

    // Extraction said "unclear" rather than guessing — the whole point of
    // having a way to say it is that somebody then reads these.
    admin
      .from("expense_line_items")
      .select("id, expense_id, description_raw, line_total, category_id, expenses!inner ( expense_number, status, vendor_name_raw )")
      .is("category_id", null)
      .eq("kind", "goods")
      .not("expenses.status", "in", NOT_SPEND_FILTER)
      .limit(100),

    admin.from("vendors").select("id, name, vendor_number, created_at").eq("status", "pending").limit(100),

    admin
      .from("pricelist_items")
      .select("id, vendor_id, item_pack_sizes ( items ( id, name ) ), vendors ( name )")
      .eq("status", "pending")
      .limit(100),

    // A pack size nobody has confirmed makes every per-unit cost derived from
    // it provisional — see migration 0014.
    admin
      .from("item_pack_sizes")
      .select("id, item_id, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging, items ( name )")
      .eq("contents_confirmed", false)
      .limit(100),

    admin.from("categories").select("id, name, parent_category_id"),

    admin.from("units").select("id, label"),
  ]);
  const unitLabelById = new Map((units ?? []).map((u) => [u.id as string, u.label as string]));

  void categoryLabelsById(categoryRows ?? []);

  const items: QueueItem[] = [];

  for (const row of unallocated ?? []) {
    const expense = row.expenses as unknown as { expense_number: string | null; vendor_name_raw: string | null };
    items.push({
      kind: "unallocated_line",
      id: row.id as string,
      title: `${money(Number(row.line_total))} not itemised`,
      detail: `${expense?.expense_number ?? "—"} · ${expense?.vendor_name_raw ?? "Unrecorded vendor"}`,
      href: `/expenses/${row.expense_id}`,
      weight: 0,
      amount: Number(row.line_total),
    });
  }

  for (const row of uncategorised ?? []) {
    const expense = row.expenses as unknown as { expense_number: string | null; vendor_name_raw: string | null };
    items.push({
      kind: "uncategorised_line",
      id: row.id as string,
      title: row.description_raw as string,
      detail: `${money(Number(row.line_total))} · ${expense?.expense_number ?? "—"} · ${expense?.vendor_name_raw ?? "Unrecorded vendor"}`,
      href: `/expenses/${row.expense_id}`,
      weight: 1,
      amount: Number(row.line_total),
    });
  }

  for (const row of vendors ?? []) {
    items.push({
      kind: "pending_vendor",
      id: row.id as string,
      title: row.name as string,
      detail: `New vendor, ${row.vendor_number ?? "not yet numbered"} — approve or merge`,
      href: `/vendors/${row.id}`,
      weight: 2,
      amount: null,
    });
  }

  for (const row of offers ?? []) {
    const pack = row.item_pack_sizes as unknown as { items: { id: string; name: string } | null } | null;
    const vendor = row.vendors as unknown as { name: string } | null;
    items.push({
      kind: "pending_item",
      id: row.id as string,
      title: pack?.items?.name ?? "Unnamed item",
      detail: `New item for ${vendor?.name ?? "an unrecorded vendor"} — approve or merge`,
      href: pack?.items?.id ? `/pricelist/${pack.items.id}` : "/pricelist",
      weight: 3,
      amount: null,
    });
  }

  for (const row of packs ?? []) {
    const item = row.items as unknown as { name: string } | null;
    items.push({
      kind: "unconfirmed_pack",
      id: row.id as string,
      title: item?.name ?? "Unnamed item",
      detail: `Nobody has confirmed what's in this pack (${describePack({
        innerQuantity: row.inner_quantity,
        unitLabel: unitLabelById.get(row.inner_unit_id as string),
        packCount: row.pack_count,
        soldLoose: row.sold_loose,
        packaging: row.packaging,
      })}) — per-unit costs are provisional`,
      href: `/pricelist/${row.item_id}`,
      weight: 4,
      amount: null,
    });
  }

  items.sort((a, b) => a.weight - b.weight || (b.amount ?? 0) - (a.amount ?? 0));

  const counts = items.reduce(
    (acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }),
    {} as Record<QueueItemKind, number>
  );

  return { items, counts };
}
