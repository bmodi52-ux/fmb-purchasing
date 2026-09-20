import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlainDate } from "@/lib/format";
import { formatHijri, gregorianToHijri } from "@/lib/hijri/hijri";
import { costMenuDay, type MenuDayCost, type MenuDish } from "@/lib/menu-costing";
import { SECTIONS, SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";
import { loadDishes, loadItemPrices, loadKitchens, loadSections } from "../data";
import { MenuTabs } from "../tabs";

export const metadata = { title: "Thaali menu · Sheet" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The header colours of the sheet this replaces: red, green, blue. */
const SECTION_CLASS: Record<SectionKey, string> = {
  meat: "bg-maroon/10 text-maroon",
  produce: "bg-palm/10 text-palm",
  dry: "bg-gold/20 text-gold-deep",
};

type Column = {
  date: string;
  kitchenId: string;
  kitchenName: string;
  dishes: MenuDish[];
  thaalis: number;
  cost: MenuDayCost | null;
};

/**
 * The planning sheet, as a sheet (#70).
 *
 * The Google Sheet this comes from is a column per thaali day, with the menu
 * at the top and then Meat, Veggies and Rashan beneath it — and that shape is
 * right: it is how a week is read when several days are being bought for at
 * once. What it could not do is work the quantities out, which is the only
 * part that changes here. Every figure in this table is derived.
 */
export default async function MenuSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kitchens?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");

  const { from: fromParam, to: toParam, kitchens: kitchensParam } = await searchParams;
  const admin = createAdminClient();

  const kitchens = await loadKitchens(admin);
  const asked = kitchensParam === undefined ? null : new Set(kitchensParam.split(",").filter(Boolean));
  const showing = kitchens.filter((k) => asked === null || asked.has(k.id));
  const showingIds = new Set((showing.length > 0 ? showing : kitchens).map((k) => k.id));

  // A fortnight from today by default: long enough to plan a shop, short
  // enough to read across a screen.
  const today = new Date();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam ?? "") ? fromParam! : isoDate(today);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toParam ?? "")
    ? toParam!
    : isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));

  const { data: days } = await admin
    .from("menu_days")
    .select(
      "id, kitchen_id, service_date, planned_thaalis, confirmed_thaalis, menu_day_dishes ( dish_id, sort_order )"
    )
    .in("kitchen_id", [...showingIds])
    .gte("service_date", from)
    .lte("service_date", to)
    .order("service_date");

  const dishIds = [...new Set((days ?? []).flatMap((d) => (d.menu_day_dishes ?? []).map((x) => x.dish_id as string)))];
  const dishes = await loadDishes(admin, dishIds);
  const dishById = new Map(dishes.map((d) => [d.dishId, d]));
  const itemIds = [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))];
  const prices = await loadItemPrices(admin, itemIds);

  const sectionByItem = await loadSections(admin, itemIds);

  const columns: Column[] = (days ?? []).map((d) => {
    const onDay = [...(d.menu_day_dishes ?? [])]
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .flatMap((x) => dishById.get(x.dish_id as string) ?? []);
    const thaalis = Number(d.confirmed_thaalis ?? d.planned_thaalis);
    return {
      date: d.service_date as string,
      kitchenId: d.kitchen_id as string,
      kitchenName: kitchens.find((k) => k.id === d.kitchen_id)?.name ?? "",
      dishes: onDay,
      thaalis,
      cost: onDay.length > 0 ? costMenuDay(onDay, thaalis, prices) : null,
    };
  });

  // Rows are items; a cell is what that item is needed for on that day.
  const rows = new Map<string, { itemId: string; itemName: string; unit: string; section: SectionKey }>();
  const cells = new Map<string, number>();
  columns.forEach((column, i) => {
    for (const line of column.cost?.lines ?? []) {
      rows.set(line.itemId, {
        itemId: line.itemId,
        itemName: line.itemName,
        unit: line.baseUnitCode,
        section: sectionByItem.get(line.itemId) ?? "dry",
      });
      cells.set(`${line.itemId}:${i}`, line.quantity);
    }
  });

  const bySection = SECTIONS.map((section) => ({
    section,
    items: [...rows.values()]
      .filter((r) => r.section === section)
      .sort((a, b) => a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" })),
  })).filter((s) => s.items.length > 0);

  const rangeQuery = (next: { from?: string; to?: string }) => {
    const params = new URLSearchParams({ from: next.from ?? from, to: next.to ?? to });
    if (showingIds.size !== kitchens.length) params.set("kitchens", [...showingIds].join(","));
    return `/menus/sheet?${params.toString()}`;
  };

  const shift = (days: number) => {
    const move = (d: string) => {
      const date = new Date(`${d}T00:00:00`);
      return isoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
    };
    return rangeQuery({ from: move(from), to: move(to) });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Thaali menu</h1>
        <p className="page-description mt-1 max-w-2xl">
          Every day side by side, with what each one needs under Meat, Fresh produce and Dry goods — the planning
          sheet, with the quantities worked out rather than typed.
        </p>
      </div>

      <MenuTabs active="sheet" />

      <form action="/menus/sheet" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        {showingIds.size !== kitchens.length && (
          <input type="hidden" name="kitchens" value={[...showingIds].join(",")} />
        )}
        <button type="submit" className="rounded-md border border-ink/15 px-4 py-2 hover:border-ink/30">
          Show
        </button>
        <Link href={shift(-14)} className="rounded-md border border-ink/15 px-3 py-2 hover:border-ink/30">
          ← Earlier
        </Link>
        <Link href={shift(14)} className="rounded-md border border-ink/15 px-3 py-2 hover:border-ink/30">
          Later →
        </Link>
      </form>

      {kitchens.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink/55">Kitchens:</span>
          {kitchens.map((k) => {
            const on = showingIds.has(k.id);
            const next = new Set(showingIds);
            if (on) next.delete(k.id);
            else next.add(k.id);
            const params = new URLSearchParams({ from, to });
            if (next.size > 0 && next.size !== kitchens.length) params.set("kitchens", [...next].join(","));
            return (
              <Link
                key={k.id}
                href={`/menus/sheet?${params.toString()}`}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors ${
                  on ? "border-gold-deep bg-gold/10 text-ink" : "border-ink/15 text-ink/55 hover:border-ink/30"
                }`}
              >
                <span aria-hidden="true" className={on ? "text-gold-deep" : "text-ink/30"}>
                  {on ? "☑" : "☐"}
                </span>
                {k.name}
              </Link>
            );
          })}
        </div>
      )}

      {columns.length === 0 ? (
        <p className="text-sm text-ink/55">No menus between these dates.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-cream p-2 text-left align-bottom">
                  <span className="text-xs text-ink/50">Item</span>
                </th>
                {columns.map((column) => (
                  <th
                    key={`${column.date}-${column.kitchenId}`}
                    scope="col"
                    className="min-w-44 border-b border-ink/10 p-2 text-left align-bottom"
                  >
                    <Link href={`/menus/${column.date}?kitchen=${column.kitchenId}`} className="hover:text-ink">
                      <span className="block font-medium text-ink">
                        {new Date(`${column.date}T00:00:00`).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          weekday: "short",
                        })}
                      </span>
                      <span className="block text-xs text-ink/45">
                        {formatHijri(gregorianToHijri(new Date(`${column.date}T00:00:00`)))}
                      </span>
                      {showingIds.size > 1 && <span className="block text-xs text-ink/55">{column.kitchenName}</span>}
                      <span className="mt-1 block text-xs leading-snug text-ink/75">
                        {column.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}
                      </span>
                      <span className="mt-1 block text-xs text-ink/50">
                        {column.thaalis} thaalis
                        {column.cost?.perThaali != null && ` · ${money(column.cost.perThaali)} each`}
                      </span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>

            {bySection.map(({ section, items: sectionItems }) => (
              <tbody key={section}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={columns.length + 1}
                    className={`sticky left-0 p-1.5 text-left text-xs font-medium tracking-wide uppercase ${SECTION_CLASS[section]}`}
                  >
                    {SECTION_LABEL[section]}
                  </th>
                </tr>
                {sectionItems.map((row) => (
                  <tr key={row.itemId} className="border-b border-ink/5">
                    <th scope="row" className="sticky left-0 z-10 bg-cream p-2 text-left font-normal text-ink">
                      {row.itemName}
                    </th>
                    {columns.map((column, i) => {
                      const quantity = cells.get(`${row.itemId}:${i}`);
                      return (
                        <td
                          key={`${column.date}-${column.kitchenId}`}
                          className="border-b border-ink/5 p-2 font-mono whitespace-nowrap text-ink/80"
                        >
                          {quantity == null ? <span className="text-ink/20">—</span> : `${quantity} ${row.unit}`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}

            <tfoot>
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-cream p-2 text-left text-ink">
                  Day total
                </th>
                {columns.map((column) => (
                  <td
                    key={`${column.date}-${column.kitchenId}`}
                    className="border-t border-ink/15 p-2 font-mono whitespace-nowrap text-ink"
                  >
                    {column.cost ? money(column.cost.total) : "—"}
                    {column.cost && column.cost.unpriced > 0 && (
                      <span className="block text-xs text-alert">
                        {column.cost.unpriced} with no price
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-ink/45">
        Quantities are in each item&apos;s own unit, added up across every dish on that day. A day with a confirmed
        thaali count uses it; otherwise the planned one. {formatPlainDate(from)} to {formatPlainDate(to)}.
      </p>
    </div>
  );
}
