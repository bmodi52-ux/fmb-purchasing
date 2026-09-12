import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/supabase/all-rows";
import { getSetting, type PriceAlertSettings } from "@/lib/app-settings";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import {
  cheapestRecent,
  limitsFor,
  previousPurchase,
  priceFlagsFor,
  spendHistoryFor,
  unusualSpend,
  type CheapestSource,
  type ExpenseForSpend,
  type ItemPriceSettings,
  type PriceFlag,
  type PriceLimitSource,
  type PricePoint,
  type UnusualSpend,
} from "@/lib/price-alerts";

/**
 * Loading what the price and spend judgements in price-alerts.ts need (#29,
 * #42). Read when a page is shown rather than stored when an expense is
 * submitted, so a limit changed today applies to everything still waiting.
 */

/** Ids travel in the URL, so long lists go in pieces. */
const CHUNK = 150;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

type PaidCostRow = {
  line_item_id: string;
  expense_id: string;
  item_id: string;
  vendor_id: string | null;
  receipt_date: string | null;
  submitted_at: string;
  cost_per_base_unit: number | string;
  base_unit_code: string;
  contents_confirmed: boolean;
};

const PAID_COST_COLUMNS =
  "line_item_id, expense_id, item_id, vendor_id, receipt_date, submitted_at, cost_per_base_unit, base_unit_code, contents_confirmed";

function toPoint(r: PaidCostRow): PricePoint {
  return {
    lineId: r.line_item_id,
    expenseId: r.expense_id,
    itemId: r.item_id,
    vendorId: r.vendor_id,
    date: r.receipt_date ?? r.submitted_at.slice(0, 10),
    submittedAt: r.submitted_at,
    costPerUnit: Number(r.cost_per_base_unit),
    unit: r.base_unit_code,
    confirmed: r.contents_confirmed,
  };
}

async function paidCosts(
  admin: SupabaseClient,
  column: "expense_id" | "item_id",
  ids: string[]
): Promise<PricePoint[]> {
  const rows: PaidCostRow[] = [];
  for (const part of chunks(ids)) {
    rows.push(
      ...(await allRows<PaidCostRow>((from, to) =>
        admin.from("item_paid_unit_costs").select(PAID_COST_COLUMNS).in(column, part).order("line_item_id").range(from, to)
      ))
    );
  }
  return rows.map(toPoint);
}

/** The price flags on each expense's lines, keyed by expense id. Empty when price alerts are off. */
export async function loadPriceFlags(
  admin: SupabaseClient,
  expenseIds: string[],
  settings?: PriceAlertSettings
): Promise<Map<string, PriceFlag[]>> {
  const result = new Map<string, PriceFlag[]>();
  const config = settings ?? (await getSetting(admin, "price_alerts"));
  if (!config.enabled || expenseIds.length === 0) return result;

  const points = await paidCosts(admin, "expense_id", expenseIds);
  const itemIds = [...new Set(points.map((p) => p.itemId))];
  if (itemIds.length === 0) return result;

  const [history, items] = await Promise.all([
    paidCosts(admin, "item_id", itemIds),
    (async () => {
      const rows: (ItemPriceSettings & { id: string; name: string; category_id: string | null })[] = [];
      for (const part of chunks(itemIds)) {
        const { data } = await admin
          .from("items")
          .select("id, name, category_id, price_rise_percent, price_fall_percent, expected_min_per_unit, expected_max_per_unit")
          .in("id", part);
        rows.push(...((data ?? []) as typeof rows));
      }
      return rows;
    })(),
  ]);

  const categoryIds = [...new Set(items.map((i) => i.category_id).filter(Boolean) as string[])];
  const { data: categories } = categoryIds.length
    ? await admin.from("categories").select("id, price_rise_percent, price_fall_percent").in("id", categoryIds)
    : { data: [] };
  const categoryById = new Map(((categories ?? []) as (PriceLimitSource & { id: string })[]).map((c) => [c.id, c]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  for (const p of points) {
    const item = itemById.get(p.itemId);
    if (!item) continue;
    const limits = limitsFor(config, item.category_id ? (categoryById.get(item.category_id) ?? null) : null, item);
    const flags = priceFlagsFor(p, previousPurchase(p, history), limits, item.name);
    if (flags.length) result.set(p.expenseId, [...(result.get(p.expenseId) ?? []), ...flags]);
  }
  return result;
}

/** Expenses well above their vendor's usual, keyed by expense id. Empty when price alerts are off. */
export async function loadSpendFlags(
  admin: SupabaseClient,
  expenses: ExpenseForSpend[],
  settings?: PriceAlertSettings
): Promise<Map<string, UnusualSpend>> {
  const result = new Map<string, UnusualSpend>();
  const config = settings ?? (await getSetting(admin, "price_alerts"));
  const vendorIds = [...new Set(expenses.map((e) => e.vendor_id).filter(Boolean) as string[])];
  if (!config.enabled || vendorIds.length === 0) return result;

  // A year before the earliest of them, with a few days' slack for receipts
  // dated before they were submitted.
  const earliest = expenses.map((e) => e.receipt_date ?? e.created_at.slice(0, 10)).sort()[0];
  const since = new Date(`${earliest}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 400);

  const others: ExpenseForSpend[] = [];
  for (const part of chunks(vendorIds)) {
    others.push(
      ...(await allRows<ExpenseForSpend>((from, to) =>
        admin
          .from("expenses")
          .select("id, vendor_id, total, receipt_date, created_at")
          .in("vendor_id", part)
          .not("status", "in", NOT_SPEND_FILTER)
          .gte("created_at", since.toISOString())
          .order("id")
          .range(from, to)
      ))
    );
  }

  for (const e of expenses) {
    const found = unusualSpend(Number(e.total), spendHistoryFor(e, others), config);
    if (found) result.set(e.id, found);
  }
  return result;
}

/** Each item's cheapest price paid per unit in the recent window, and who charged it. */
export async function loadCheapestRecent(
  admin: SupabaseClient,
  days: number,
  today: string,
  itemId?: string
): Promise<Map<string, CheapestSource>> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - Math.max(1, days));
  const sinceDay = since.toISOString().slice(0, 10);
  // Submitted a little earlier than the window, to catch receipts dated inside it.
  const submittedSince = new Date(since);
  submittedSince.setUTCDate(submittedSince.getUTCDate() - 30);

  const rows = await allRows<PaidCostRow>((from, to) => {
    const query = admin
      .from("item_paid_unit_costs")
      .select(PAID_COST_COLUMNS)
      .gte("submitted_at", submittedSince.toISOString());
    return (itemId ? query.eq("item_id", itemId) : query).order("line_item_id").range(from, to);
  });
  return cheapestRecent(rows.map(toPoint), sinceDay);
}
