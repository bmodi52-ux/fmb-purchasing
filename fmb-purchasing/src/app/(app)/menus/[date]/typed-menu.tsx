import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { SECTIONS, SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";
import type { MenuLine } from "@/lib/menu-costing";
import { REMOVE_BUTTON } from "./styles";

/**
 * A day planned the way the Google Sheet plans it (#77).
 *
 * The menu is typed, and under it the quantities are typed, under the heading
 * each belongs to. Nothing is worked out: what is written is what gets bought.
 * That is the whole point — the team can be off the sheet without anybody
 * having written a recipe first.
 *
 * Everything after this is unchanged. A typed quantity becomes a requirement
 * at release exactly as a calculated one does, so the section lists, who buys
 * what, ordered and delivered, and the receipts allocated back all work on a
 * day planned this way.
 */
type Action = (formData: FormData) => void | Promise<void>;

export function TypedMenu({
  hidden,
  rowHidden,
  actions,
  menuText,
  lines,
  items,
  units,
  sectionFor,
  canManage,
}: {
  /** Says which menu the text and new lines belong to: a day, or a saved menu (#17). */
  hidden: Record<string, string>;
  /** Carried by the forms on each line. */
  rowHidden: Record<string, string>;
  actions: { setText: Action; addLine: Action; setLine: Action; removeLine: Action };
  menuText: string | null;
  lines: MenuLine[];
  items: { id: string; name: string }[];
  units: { id: string; code: string; label: string | null }[];
  /** Where a line sits when nobody said: the item's own list. */
  sectionFor: (itemId: string) => SectionKey;
  canManage: boolean;
}) {
  const sectionOf = (line: MenuLine): SectionKey =>
    (SECTIONS as readonly string[]).includes(line.section ?? "")
      ? (line.section as SectionKey)
      : sectionFor(line.itemId);

  const unitId = (line: MenuLine) => units.find((u) => u.code === line.unitCode)?.id ?? "";

  return (
    <>
      <section className="card p-5">
        <h2 className="section-title text-ink">Menu</h2>
        <p className="mt-0.5 text-sm text-ink/55">
          What is being served, in your own words. Nothing is worked out from it — the quantities below are what gets
          bought.
        </p>

        {canManage ? (
          <form action={actions.setText} className="mt-3 flex flex-col gap-2">
            <Hidden fields={hidden} />
            <FormResetBoundary>
              <textarea
                name="menu_text"
                rows={3}
                defaultValue={menuText ?? ""}
                placeholder="e.g. Bhuna gosht, rotli, kheer"
                className="input w-full"
              />
            </FormResetBoundary>
            <SubmitButton className="btn btn-primary self-start">
              Save menu
            </SubmitButton>
          </form>
        ) : menuText ? (
          <p className="mt-3 whitespace-pre-wrap text-ink">{menuText}</p>
        ) : (
          <p className="mt-3 text-sm text-ink/45">Nothing written yet.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="section-title text-ink">What to buy</h2>
        <p className="mt-0.5 text-sm text-ink/55">
          Typed in, under the list it belongs to. Releasing the day hands each list to whoever buys it, exactly as it
          does for a day worked out from recipes.
        </p>

        {lines.length === 0 ? (
          <p className="mt-3 text-sm text-ink/55">Nothing listed yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {SECTIONS.filter((section) => lines.some((l) => sectionOf(l) === section)).map((section) => (
              <div key={section}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/45">
                  {SECTION_LABEL[section]}
                </h3>
                <ul className="flex flex-col gap-1">
                  {lines
                    .filter((line) => sectionOf(line) === section)
                    .map((line) => (
                      <li
                        key={line.lineId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/5 py-2 text-sm last:border-0"
                      >
                        <span className="min-w-48 flex-1 text-ink">{line.itemName}</span>
                        {canManage ? (
                          <form action={actions.setLine} className="flex flex-wrap items-center gap-1">
                            <input type="hidden" name="line_id" value={line.lineId} />
                            <Hidden fields={rowHidden} />
                            <FormResetBoundary>
                              <input
                                name="quantity"
                                type="number"
                                min="0.001"
                                step="any"
                                defaultValue={line.quantity}
                                aria-label={`How much ${line.itemName}`}
                                className="input w-24 py-1 text-sm"
                              />
                              <select
                                key={unitId(line)}
                                name="unit_id"
                                defaultValue={unitId(line)}
                                aria-label={`Unit for ${line.itemName}`}
                                className="input py-1 text-sm"
                              >
                                {units.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.code}
                                  </option>
                                ))}
                              </select>
                              <select
                                key={line.section ?? "auto"}
                                name="section"
                                defaultValue={line.section ?? ""}
                                aria-label={`List for ${line.itemName}`}
                                className="input py-1 text-sm"
                              >
                                <option value="">from the item ({SECTION_LABEL[sectionFor(line.itemId)]})</option>
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
                        ) : (
                          <span className="tabular-nums text-ink/70">
                            {line.quantity} {line.unitCode}
                          </span>
                        )}
                        {canManage && (
                          <form action={actions.removeLine}>
                            <input type="hidden" name="line_id" value={line.lineId} />
                            <Hidden fields={rowHidden} />
                            <SubmitButton className={REMOVE_BUTTON} pendingLabel="Removing…">Remove</SubmitButton>
                          </form>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <form action={actions.addLine} className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
            <Hidden fields={hidden} />
            <FormResetBoundary>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Item</span>
                <select name="item_id" required defaultValue="" className="input max-w-xs">
                  <option value="" disabled>
                    — choose —
                  </option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">How much</span>
                <input name="quantity" type="number" min="0.001" step="any" required className="input w-28" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Unit</span>
                <select name="unit_id" required defaultValue={units.find((u) => u.code === "kg")?.id ?? ""} className="input">
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label ? `${u.code} — ${u.label}` : u.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">List</span>
                <select name="section" defaultValue="" className="input">
                  <option value="">from the item</option>
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </FormResetBoundary>
            <SubmitButton className="btn btn-secondary">
              Add
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
