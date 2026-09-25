import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { todayIso } from "@/lib/periods-data";
import { priceFor } from "@/lib/menu-costing";
import { changeSinceLast, recentDates, totalValue, valueOf, type StockCount } from "@/lib/stock-count";
import { loadItemPrices } from "../../menus/data";
import { ProcurementTabs } from "../tabs";
import { addStockItem, removeStockCount, removeStockItem, saveStockCount } from "./actions";

export const metadata = { title: "Procurement · Stock count" };

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type Unit = { id: string; code: string; to_base_factor: number; base_unit_code: string };

/**
 * The monthly count of high-value stock (#10): meat, rice, oil, ghee — what
 * is on the shelf, and what it is worth. A record kept alongside the menus;
 * it doesn't change what anybody is asked to buy.
 */
export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "view");
  const canManage = can(await getUserPermissions(user), "procurement", "manage");
  const { saved, date: savedDate } = await searchParams;

  const admin = createAdminClient();
  const today = todayIso();
  const [{ data: tracked }, { data: units }, { data: allItems }] = await Promise.all([
    admin.from("stock_count_items").select("item_id, sort_order, items ( name, canonical_unit_id )").order("sort_order"),
    admin.from("units").select("id, code, to_base_factor, base_unit_code").order("sort_order"),
    canManage ? admin.from("items").select("id, name").order("name").limit(2000) : Promise.resolve({ data: [] }),
  ]);
  const items = (tracked ?? []).map((t) => {
    const item = one(t.items) as { name: string; canonical_unit_id: string | null } | null;
    return { id: t.item_id as string, name: item?.name ?? "Item", unitId: item?.canonical_unit_id ?? null };
  });
  const itemIds = items.map((i) => i.id);
  const unitById = new Map(((units ?? []) as Unit[]).map((u) => [u.id, u]));

  const [{ data: countRows }, prices] = await Promise.all([
    itemIds.length
      ? admin
          .from("stock_counts")
          .select("id, counted_on, item_id, quantity, unit_id, note")
          .in("item_id", itemIds)
          .order("counted_on", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [] }),
    loadItemPrices(admin, itemIds),
  ]);
  const counts: (StockCount & { id: string; unitId: string; note: string | null })[] = (countRows ?? []).map((c) => {
    const unit = unitById.get(c.unit_id as string);
    return {
      id: c.id as string,
      countedOn: c.counted_on as string,
      itemId: c.item_id as string,
      quantity: Number(c.quantity),
      unitId: c.unit_id as string,
      unitCode: unit?.code ?? "",
      toBase: Number(unit?.to_base_factor ?? 1),
      note: (c.note as string | null) ?? null,
    };
  });
  const priceOf = (itemId: string) => priceFor(prices.get(itemId)).perUnit;
  const dates = recentDates(counts);
  const latestOf = (itemId: string) => counts.find((c) => c.itemId === itemId) ?? null;
  const baseOf = (itemId: string) => {
    const latest = latestOf(itemId);
    if (latest) return unitById.get(latest.unitId)?.base_unit_code ?? latest.unitCode;
    const item = items.find((i) => i.id === itemId);
    return (item?.unitId && unitById.get(item.unitId)?.base_unit_code) || "";
  };
  const trackedIds = new Set(itemIds);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Procurement</h1>
        <p className="page-description mt-1 max-w-2xl">
          A monthly count of the high-value stock on the shelf, and what it is worth.
        </p>
      </div>

      <ProcurementTabs active="stock" canManage={canManage} />

      {saved && (
        <p role="status" className="rounded-md border border-palm/30 bg-palm/10 px-4 py-3 text-sm text-ink">
          Saved {saved} {saved === "1" ? "count" : "counts"} for {savedDate ? formatPlainDate(savedDate) : "the day"}.
        </p>
      )}

      <section className="card p-5">
        <h2 className="mb-1 section-title text-ink">Count</h2>
        <p className="mb-4 text-sm text-ink/55">
          Fill in what is there now. Leave an item blank to skip it; counting it again on the same date corrects it.
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-ink/55">
            Nothing is on the list to count yet.
            {canManage ? " Add the items below." : " Whoever runs procurement can add them."}
          </p>
        ) : (
          <form action={saveStockCount} className="flex flex-col gap-3">
            <label className="flex w-48 flex-col gap-1 text-sm">
              <span className="text-ink/70">Counted on</span>
              <input type="date" name="counted_on" defaultValue={today} max={today} required className="input" />
            </label>
            <ul className="flex flex-col divide-y divide-ink/5 rounded-md border border-ink/10 bg-white">
              {items.map((item) => {
                const latest = latestOf(item.id);
                const unitDefault = latest?.unitId ?? item.unitId ?? "";
                return (
                  <li key={item.id} className="flex flex-wrap items-end gap-x-3 gap-y-2 p-3 text-sm">
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="min-w-44 flex-1">
                      <p className="text-ink">{item.name}</p>
                      <p className="text-xs text-ink/50">
                        {latest
                          ? `Last: ${latest.quantity} ${latest.unitCode} on ${formatPlainDate(latest.countedOn)}`
                          : "Not counted yet"}
                      </p>
                    </div>
                    <FormResetBoundary>
                      <input
                        name={`quantity_${item.id}`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={`How much ${item.name}`}
                        className="input w-28"
                      />
                      <select
                        name={`unit_${item.id}`}
                        defaultValue={unitDefault}
                        aria-label={`Unit for ${item.name}`}
                        className="input"
                      >
                        {((units ?? []) as Unit[]).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                          </option>
                        ))}
                      </select>
                      <input
                        name={`note_${item.id}`}
                        placeholder="note"
                        aria-label={`Note for ${item.name}`}
                        className="input w-40"
                      />
                    </FormResetBoundary>
                  </li>
                );
              })}
            </ul>
            <SubmitButton
              pendingLabel="Saving…"
              className="btn btn-primary self-start"
            >
              Save count
            </SubmitButton>
          </form>
        )}
      </section>

      {dates.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 section-title text-ink">The last {dates.length === 1 ? "count" : `${dates.length} counts`}</h2>
          <p className="mb-3 text-sm text-ink/55">Valued at what was last paid, so the columns compare like with like.</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th scope="col" className="p-2">Item</th>
                  {dates.map((d) => (
                    <th key={d} scope="col" className="p-2 text-right whitespace-nowrap">
                      {formatPlainDate(d)}
                    </th>
                  ))}
                  <th scope="col" className="p-2 text-right">Since last</th>
                  <th scope="col" className="p-2 text-right">Worth now</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const latest = latestOf(item.id);
                  const change = changeSinceLast(counts, item.id);
                  return (
                    <tr key={item.id} className="border-t border-ink/5">
                      <td className="p-2 text-ink">{item.name}</td>
                      {dates.map((d) => {
                        const c = counts.find((x) => x.itemId === item.id && x.countedOn === d);
                        return (
                          <td key={d} className="p-2 text-right tabular-nums whitespace-nowrap text-ink/80" title={c?.note ?? undefined}>
                            {c ? `${c.quantity} ${c.unitCode}` : "—"}
                            {c && canManage && (
                              <form action={removeStockCount} className="inline">
                                <input type="hidden" name="count_id" value={c.id} />
                                <SubmitButton
                                  aria-label={`Remove the ${item.name} count on ${formatPlainDate(d)}`}
                                  className="ml-1 text-xs text-ink/30 hover:text-danger"
                                >
                                  ✕
                                </SubmitButton>
                              </form>
                            )}
                          </td>
                        );
                      })}
                      <td
                        className={`p-2 text-right tabular-nums whitespace-nowrap ${
                          change == null ? "text-ink/40" : change < 0 ? "text-ink/80" : "text-palm"
                        }`}
                      >
                        {change == null ? "—" : `${change > 0 ? "+" : ""}${change} ${baseOf(item.id)}`}
                      </td>
                      <td className="p-2 text-right tabular-nums whitespace-nowrap">
                        {latest ? money(valueOf(latest, priceOf(item.id))) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-ink/15 font-medium">
                  <td className="p-2 text-ink">Worth, at today&apos;s prices</td>
                  {dates.map((d) => {
                    const t = totalValue(counts, d, priceOf);
                    return (
                      <td key={d} className="p-2 text-right tabular-nums whitespace-nowrap">
                        {money(t.value)}
                        {t.unpriced > 0 && <span className="block text-xs font-normal text-alert">{t.unpriced} unpriced</span>}
                      </td>
                    );
                  })}
                  <td />
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                    {money(
                      items.reduce((sum, item) => {
                        const latest = latestOf(item.id);
                        return sum + (latest ? (valueOf(latest, priceOf(item.id)) ?? 0) : 0);
                      }, 0)
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink/45">
            &ldquo;Since last&rdquo; is in each item&apos;s base unit, so counts taken in different units still line up.
          </p>
        </section>
      )}

      {canManage && (
        <section className="card p-5">
          <h2 className="mb-1 section-title text-ink">What is counted</h2>
          <p className="mb-3 text-sm text-ink/55">
            The items worth counting: the expensive ones bought in bulk. Taking one off keeps its past counts.
          </p>
          {items.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-1 rounded-full border border-ink/15 bg-white py-0.5 pr-1 pl-3 text-sm">
                  <Link href={`/pricelist/${item.id}`} className="text-ink underline-offset-2 hover:underline">
                    {item.name}
                  </Link>
                  <form action={removeStockItem}>
                    <input type="hidden" name="item_id" value={item.id} />
                    <SubmitButton aria-label={`Stop counting ${item.name}`} className="rounded-full px-1.5 text-ink/40 hover:text-danger">
                      ✕
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addStockItem} className="flex flex-wrap items-end gap-2">
            <FormResetBoundary>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Add an item</span>
                <select name="item_id" required defaultValue="" className="input max-w-xs">
                  <option value="" disabled>
                    — choose —
                  </option>
                  {(allItems ?? [])
                    .filter((i) => !trackedIds.has(i.id as string))
                    .map((i) => (
                      <option key={i.id as string} value={i.id as string}>
                        {i.name as string}
                      </option>
                    ))}
                </select>
              </label>
            </FormResetBoundary>
            <SubmitButton className="btn btn-secondary">Add</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
