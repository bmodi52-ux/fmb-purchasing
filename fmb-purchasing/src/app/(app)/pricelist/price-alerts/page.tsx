import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/app-settings";
import { categoryLabelsById, leafCategories, sortCategories } from "@/lib/categories";
import { SubmitButton } from "@/components/submit-button";
import { AutosaveInput } from "@/components/autosave-input";
import { setCategoryPriceLimits, setPriceAlertSettings } from "../price-alert-actions";

export const metadata = { title: "Price alerts" };

/**
 * The limits a price per kg, litre or each may move before anyone is told
 * (#29), and when an expense counts as well above its vendor's usual (#42).
 * The Pricelist sets the default, a category may set its own, and an item its
 * own again on its page.
 */
export default async function PriceAlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "edit_master_data");

  const admin = createAdminClient();
  const [settings, { data: categories }, { data: itemOverrides }] = await Promise.all([
    getSetting(admin, "price_alerts"),
    admin.from("categories").select("id, name, parent_category_id, price_rise_percent, price_fall_percent").order("sort_order"),
    admin
      .from("items")
      .select("id, name, item_number, price_rise_percent, price_fall_percent, expected_min_per_unit, expected_max_per_unit")
      .or(
        "price_rise_percent.not.is.null,price_fall_percent.not.is.null,expected_min_per_unit.not.is.null,expected_max_per_unit.not.is.null"
      )
      .order("name"),
  ]);

  const labels = categoryLabelsById(categories ?? []);
  const rows = leafCategories(sortCategories(categories ?? []));
  const pct = (v: unknown) => (v == null ? "" : String(Number(v)));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/pricelist" className="text-sm text-ink/50 hover:text-ink">
          ← Pricelist
        </Link>
        <h1 className="page-title mt-1 text-ink">Price alerts</h1>
        <p className="page-description mt-1 max-w-2xl">
          When a purchase costs more or less per kg, litre or each than the last one by more than the limit, it is
          flagged on Approvals and on the expense. So is an expense far above what its vendor usually costs.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">For the whole Pricelist</h2>
        <form
          action={setPriceAlertSettings}
          className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white/60 px-4 py-4 text-sm"
        >
          <label className="flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
            Flag price moves and unusual spend
          </label>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2">
              A rise of more than
              <input name="rise" defaultValue={settings.risePercent} inputMode="decimal" className="input w-20 py-1" />%
            </label>
            <label className="flex items-center gap-2">
              A fall of more than
              <input name="fall" defaultValue={settings.fallPercent} inputMode="decimal" className="input w-20 py-1" />%
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            An expense at least
            <input
              name="spend_multiple"
              defaultValue={settings.spendMultiple}
              inputMode="decimal"
              className="input w-16 py-1"
              aria-label="Times the usual expense"
            />
            × its vendor&apos;s usual, once the vendor has
            <input
              name="spend_min_history"
              defaultValue={settings.spendMinHistory}
              inputMode="numeric"
              className="input w-16 py-1"
              aria-label="Earlier expenses needed"
            />
            expenses in the year before
          </div>
          <label className="flex flex-wrap items-center gap-2">
            &ldquo;Cheapest recent source&rdquo; on the Pricelist looks back
            <input
              name="cheapest_days"
              defaultValue={settings.cheapestRecentDays}
              inputMode="numeric"
              className="input w-16 py-1"
            />
            days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="notify" defaultChecked={settings.notifyPricelistEditors} />
            Send an alert to everyone who edits the Pricelist when one is flagged
          </label>
          <p className="text-xs text-ink/55">
            To tell anyone else — a team, or only for some categories or vendors — build an alert on{" "}
            <Link href="/admin/notifications" className="underline">
              Announcements &amp; alerts
            </Link>
            .
          </p>
          <SubmitButton
            pendingLabel="Saving…"
            className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep"
          >
            Save
          </SubmitButton>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">By category</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            Leave blank to use the Pricelist&apos;s {settings.risePercent}% and {settings.fallPercent}%. Saves when you
            leave the box.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-ink/55">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Rise limit
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Fall limit
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-ink/5">
                  <th scope="row" className="px-4 py-1.5 text-left font-normal text-ink">
                    {labels.get(c.id) ?? c.name}
                  </th>
                  {(["price_rise_percent", "price_fall_percent"] as const).map((field) => (
                    <td key={field} className="px-4 py-1.5">
                      <form action={setCategoryPriceLimits} className="flex items-center gap-1">
                        <input type="hidden" name="category_id" value={c.id} />
                        <AutosaveInput
                          name={field}
                          defaultValue={pct(c[field])}
                          placeholder={String(field === "price_rise_percent" ? settings.risePercent : settings.fallPercent)}
                          inputMode="decimal"
                          className="input w-20 py-1"
                          aria-label={`${labels.get(c.id) ?? c.name}: ${field === "price_rise_percent" ? "rise" : "fall"} limit`}
                        />
                        <span className="text-xs text-ink/50">%</span>
                      </form>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Items with their own limits or expected price</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            Set on each item&apos;s page, under Buying.
          </p>
        </div>
        {(itemOverrides ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(itemOverrides ?? []).map((i) => {
              const parts = [
                i.price_rise_percent != null ? `rise ${pct(i.price_rise_percent)}%` : null,
                i.price_fall_percent != null ? `fall ${pct(i.price_fall_percent)}%` : null,
                i.expected_min_per_unit != null || i.expected_max_per_unit != null
                  ? `expected ${i.expected_min_per_unit != null ? `$${Number(i.expected_min_per_unit).toFixed(2)}` : "…"}–${
                      i.expected_max_per_unit != null ? `$${Number(i.expected_max_per_unit).toFixed(2)}` : "…"
                    } per unit`
                  : null,
              ].filter(Boolean);
              return (
                <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2">
                  <Link href={`/pricelist/${i.id}`} className="text-ink underline">
                    {i.name}
                  </Link>
                  <span className="text-xs text-ink/60">{parts.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
