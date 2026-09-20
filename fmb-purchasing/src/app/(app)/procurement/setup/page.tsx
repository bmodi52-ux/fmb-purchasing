import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { SECTIONS, SECTION_LABEL, resolveSection } from "@/lib/menu-sections";
import { loadKitchens } from "../../menus/data";
import { setCategorySection, setItemSection, setSectionOwner } from "../actions";
import { ProcurementTabs } from "../tabs";

export const metadata = { title: "Who buys what" };

/**
 * The setup behind procurement (#70): who buys each section, and which list a
 * category or item belongs on.
 *
 * Meat and Fresh produce look after themselves — their categories say what
 * they are. Dry goods is everything else, which is why this page exists: it
 * is the list that needs correcting, one category at a time.
 */
export default async function ProcurementSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");

  const admin = createAdminClient();
  const [kitchens, { data: people }, { data: owners }, { data: categories }, { data: overridden }] = await Promise.all([
    loadKitchens(admin),
    admin.from("profiles").select("id, full_name, email").order("full_name"),
    admin.from("menu_section_owners").select("id, kitchen_id, section, owner_id"),
    admin.from("categories").select("id, name, parent_category_id, menu_section").order("sort_order"),
    admin.from("items").select("id, name, item_number, menu_section").not("menu_section", "is", null).order("name"),
  ]);

  const byId = new Map((categories ?? []).map((c) => [c.id as string, c]));
  const ownerOf = (kitchenId: string | null, section: string) =>
    (owners ?? []).find((o) => o.section === section && (o.kitchen_id ?? null) === kitchenId)?.owner_id ?? "";

  const personName = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Procurement</h1>
        <p className="page-description mt-1 max-w-2xl">
          Who a released menu hands each list to, and which list a category belongs on.
        </p>
      </div>

      <ProcurementTabs active="setup" canManage />

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">Who buys each list</h2>
        <p className="mb-4 text-sm text-ink/55">
          Releasing a menu hands its lists to these people. A kitchen can name someone of its own; otherwise the
          person set for both kitchens gets it. Anything already assigned stays where it is.
        </p>

        <div className="flex flex-col gap-4">
          {[{ id: null as string | null, name: "Both kitchens" }, ...kitchens].map((kitchen) => (
            <div key={kitchen.id ?? "both"} className="rounded-md border border-ink/10 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-ink">{kitchen.name}</p>
              <div className="flex flex-wrap gap-3">
                {SECTIONS.map((section) => (
                  <form key={section} action={setSectionOwner} className="flex items-end gap-1 text-sm">
                    {kitchen.id && <input type="hidden" name="kitchen_id" value={kitchen.id} />}
                    <input type="hidden" name="section" value={section} />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink/60">{SECTION_LABEL[section]}</span>
                      <FormResetBoundary>
                        <select
                          key={ownerOf(kitchen.id, section)}
                          name="owner_id"
                          defaultValue={ownerOf(kitchen.id, section)}
                          className="input py-1 text-sm"
                        >
                          <option value="">— nobody —</option>
                          {(people ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {personName.get(p.id as string)}
                            </option>
                          ))}
                        </select>
                      </FormResetBoundary>
                    </label>
                    <SubmitButton className="rounded border border-ink/15 px-2 py-1.5 text-xs hover:border-ink/30">
                      Save
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">Which list a category is on</h2>
        <p className="mb-4 text-sm text-ink/55">
          Left alone, a category is read from its name: anything meat or poultry is Meat, anything produce is Fresh
          produce, everything else is Dry goods. Set one here when that gets it wrong — disposables and cleaning are
          not groceries.
        </p>

        <ul className="flex flex-col gap-1 text-sm">
          {(categories ?? [])
            .filter((c) => !c.parent_category_id)
            .map((category) => {
              const children = (categories ?? []).filter((c) => c.parent_category_id === category.id);
              const guessed = resolveSection({ categoryName: category.name as string });
              return (
                <li key={category.id as string} className="border-b border-ink/5 py-2 last:border-0">
                  <form action={setCategorySection} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="category_id" value={category.id as string} />
                    <span className="min-w-48 flex-1 text-ink">
                      {category.name as string}
                      {children.length > 0 && (
                        <span className="ml-1.5 text-xs text-ink/40">
                          and {children.length} {children.length === 1 ? "child" : "children"}
                        </span>
                      )}
                    </span>
                    <FormResetBoundary>
                      <select
                        key={(category.menu_section as string) ?? ""}
                        name="menu_section"
                        defaultValue={(category.menu_section as string) ?? ""}
                        aria-label={`List for ${category.name}`}
                        className="input py-1 text-sm"
                      >
                        <option value="">from its name ({SECTION_LABEL[guessed]})</option>
                        {SECTIONS.map((s) => (
                          <option key={s} value={s}>
                            {SECTION_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </FormResetBoundary>
                    <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                      Save
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
        </ul>
      </section>

      {(overridden ?? []).length > 0 && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-1 section-title text-ink">Items on a different list from their category</h2>
          <p className="mb-4 text-sm text-ink/55">
            Set from an item&apos;s own page. Clearing one puts it back with the rest of its category.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {(overridden ?? []).map((item) => (
              <li key={item.id as string} className="flex flex-wrap items-center gap-2 border-b border-ink/5 py-2 last:border-0">
                <span className="min-w-48 flex-1 text-ink">
                  {item.name as string}
                  {item.item_number && <span className="ml-1.5 font-mono text-xs text-ink/40">{item.item_number as string}</span>}
                </span>
                <span className="text-ink/60">{SECTION_LABEL[item.menu_section as "meat" | "produce" | "dry"]}</span>
                <form action={setItemSection}>
                  <input type="hidden" name="item_id" value={item.id as string} />
                  <input type="hidden" name="menu_section" value="" />
                  <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                    Clear
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink/45">
        {(byId.size || 0) > 0 && `${byId.size} categories in all.`} Changing a list here affects menus released from
        now on; a day already released keeps what it was released with.
      </p>
    </div>
  );
}
