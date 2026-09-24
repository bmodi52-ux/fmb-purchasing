import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { PickByName } from "@/components/pick-by-name";
import {
  batchesFor,
  boxesFor,
  countFor,
  portionLabel,
  PRICE_BASIS_LABEL,
  type CostedLine,
  type MenuDish,
  type MenuExtra,
} from "@/lib/menu-costing";
import { REMOVE_BUTTON } from "./[date]/styles";

/**
 * The parts of a menu that are the same wherever the menu lives: on a day, or
 * saved apart from any day (#17). The forms post to whichever actions the page
 * passes, with the hidden fields that say which menu they are about.
 */

type Action = (formData: FormData) => void | Promise<void>;
type Hidden = Record<string, string>;

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function HiddenFields({ fields }: { fields: Hidden }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

export function DishesSection({
  dishes,
  rowIdFor,
  rowField,
  thaalis,
  canManage,
  allDishes,
  hidden,
  rowHidden,
  actions,
  children,
}: {
  dishes: MenuDish[];
  /** The row joining this dish to the menu, which remove and the counts act on. */
  rowIdFor: (dishId: string) => string | undefined;
  rowField: string;
  thaalis: number;
  canManage: boolean;
  allDishes: { id: string; name: string }[];
  /** Says which menu an added dish goes on. */
  hidden: Hidden;
  /** Carried by the forms on each dish. */
  rowHidden: Hidden;
  actions: { add: Action; remove: Action; setCounts: Action };
  /** More ways to fill the menu, beside "Add a dish". */
  children?: React.ReactNode;
}) {
  const onMenu = new Set(dishes.map((d) => d.dishId));
  return (
    <section className="card p-5">
      <h2 className="mb-4 section-title text-ink">Dishes</h2>

      {dishes.length === 0 ? (
        <p className="text-sm text-ink/55">No dishes yet.{canManage && " Add the first below."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dishes.map((dish) => {
            const rowId = rowIdFor(dish.dishId);
            const boxes = boxesFor(dish, thaalis);
            const batches = batchesFor(dish, boxes);
            return (
              <li key={dish.dishId} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link href={`/menus/dishes/${dish.dishId}`} className="text-ink underline-offset-2 hover:underline">
                    {dish.dishName}
                    <span className="ml-2 text-ink/45">
                      {(dish.boxesOffered ?? 1) > 1
                        ? `${dish.boxesOffered} × ${portionLabel(dish.portionMl)} offered`
                        : portionLabel(dish.portionMl)}
                    </span>
                  </Link>
                  <span className="text-ink/55">
                    {boxes} {boxes === 1 ? "box" : "boxes"}
                    {dish.basis === "batch" && ` · ${batches} × the batch of ${dish.batchBoxes}`}
                  </span>
                  {canManage && rowId && (
                    <form action={actions.remove}>
                      <input type="hidden" name={rowField} value={rowId} />
                      <HiddenFields fields={rowHidden} />
                      <SubmitButton className={REMOVE_BUTTON} pendingLabel="Removing…">
                        Remove
                      </SubmitButton>
                    </form>
                  )}
                </div>

                {canManage && rowId && (
                  <form
                    action={actions.setCounts}
                    className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/5 pt-2"
                  >
                    <input type="hidden" name={rowField} value={rowId} />
                    <HiddenFields fields={rowHidden} />
                    <FormResetBoundary>
                      <label className="flex flex-col gap-0.5 text-xs">
                        <span className="text-ink/55">Boxes a thaali may take</span>
                        <input
                          name="boxes_offered"
                          type="number"
                          min="1"
                          step="1"
                          defaultValue={dish.boxesOffered ?? 1}
                          className="input w-20 py-1 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs">
                        <span className="text-ink/55">Boxes to fill</span>
                        <input
                          name="expected_boxes"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={dish.expectedBoxes ?? ""}
                          placeholder={String(thaalis * (dish.boxesOffered ?? 1))}
                          className="input w-24 py-1 text-sm"
                        />
                      </label>
                    </FormResetBoundary>
                    <SubmitButton className="btn btn-secondary btn-xs">
                      Save
                    </SubmitButton>
                    <span className="text-xs text-ink/40">
                      Left blank, everyone takes all {dish.boxesOffered ?? 1} of it.
                    </span>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:flex-wrap sm:items-end">
          <form action={actions.add} className="flex flex-wrap items-end gap-2">
            <HiddenFields fields={hidden} />
            <FormResetBoundary>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Add a dish</span>
                <PickByName
                  name="dish_id"
                  required
                  placeholder="Start typing a dish"
                  options={allDishes.filter((d) => !onMenu.has(d.id))}
                  className="input w-64"
                />
              </label>
            </FormResetBoundary>
            <SubmitButton className="btn btn-secondary">
              Add
            </SubmitButton>
          </form>
          {children}
        </div>
      )}
    </section>
  );
}

export function ExtrasSection({
  extras,
  thaalis,
  canManage,
  allItems,
  hidden,
  rowHidden,
  actions,
}: {
  extras: MenuExtra[];
  thaalis: number;
  canManage: boolean;
  allItems: { id: string; name: string }[];
  hidden: Hidden;
  rowHidden: Hidden;
  actions: { add: Action; remove: Action; setCounts: Action };
}) {
  return (
    <section className="card p-5">
      <div className="mb-3">
        <h2 className="section-title text-ink">Roti, fruit and extras</h2>
        <p className="mt-0.5 text-sm text-ink/55">
          Bought, not cooked. Set how much goes in one thaali; only how many take it varies.
        </p>
      </div>

      {extras.length === 0 ? (
        <p className="text-sm text-ink/55">Nothing but the dishes.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {extras.map((extra) => {
            const count = countFor(extra, thaalis);
            return (
              <li key={extra.extraId} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-ink">
                    {extra.itemName}
                    <span className="ml-2 text-xs uppercase tracking-wide text-ink/40">{extra.kind}</span>
                  </span>
                  <span className="text-ink/55">
                    {extra.perThaali} {extra.unitCode} each · {count} taking it ={" "}
                    <span className="tabular-nums text-ink/70">
                      {Math.round(extra.perThaali * count * 1000) / 1000} {extra.unitCode}
                    </span>
                  </span>
                  {canManage && (
                    <form action={actions.remove}>
                      <input type="hidden" name="extra_id" value={extra.extraId} />
                      <HiddenFields fields={rowHidden} />
                      <SubmitButton className={REMOVE_BUTTON} pendingLabel="Removing…">
                        Remove
                      </SubmitButton>
                    </form>
                  )}
                </div>

                {canManage && (
                  <form
                    action={actions.setCounts}
                    className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/5 pt-2"
                  >
                    <input type="hidden" name="extra_id" value={extra.extraId} />
                    <HiddenFields fields={rowHidden} />
                    <FormResetBoundary>
                      <label className="flex flex-col gap-0.5 text-xs">
                        <span className="text-ink/55">How much in a thaali</span>
                        <input
                          name="per_thaali"
                          type="number"
                          min="0.01"
                          step="any"
                          defaultValue={extra.perThaali}
                          className="input w-24 py-1 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5 text-xs">
                        <span className="text-ink/55">How many take it</span>
                        <input
                          name="expected_count"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={extra.expectedCount ?? ""}
                          placeholder={String(thaalis)}
                          className="input w-24 py-1 text-sm"
                        />
                      </label>
                    </FormResetBoundary>
                    <SubmitButton className="btn btn-secondary btn-xs">
                      Save
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form action={actions.add} className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
          <HiddenFields fields={hidden} />
          <FormResetBoundary>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Add</span>
              <select name="kind" defaultValue="roti" className="input">
                <option value="roti">Roti</option>
                <option value="fruit">Fruit</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Item</span>
              <PickByName
                name="item_id"
                required
                placeholder="Start typing an item"
                options={allItems}
                className="input w-64"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">How much each</span>
              <input name="per_thaali" type="number" min="0.01" step="any" defaultValue="1" className="input w-24" />
            </label>
          </FormResetBoundary>
          <SubmitButton className="btn btn-secondary">
            Add
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

/** What each item comes to: how much, at what price, and which dishes want it. */
export function CostLinesTable({ lines }: { lines: CostedLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink/50">
            <th scope="col" className="p-2">Item</th>
            <th scope="col" className="p-2">Needed</th>
            <th scope="col" className="p-2">Price</th>
            <th scope="col" className="p-2">Cost</th>
            <th scope="col" className="p-2">For</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.itemId} className="border-t border-ink/5">
              <td className="p-2 text-ink">{line.itemName}</td>
              <td className="p-2 tabular-nums whitespace-nowrap text-ink/80">
                {line.quantity} {line.baseUnitCode}
              </td>
              <td className="p-2 whitespace-nowrap text-ink/60">
                {line.perUnit == null ? (
                  <span className="text-alert">no price yet</span>
                ) : (
                  <>
                    <span className="tabular-nums">
                      {money(line.perUnit)}/{line.baseUnitCode}
                    </span>
                    <span className="block text-xs text-ink/45">{PRICE_BASIS_LABEL[line.basis]}</span>
                  </>
                )}
              </td>
              <td className="p-2 tabular-nums whitespace-nowrap text-ink/80">
                {line.cost == null ? "—" : money(line.cost)}
              </td>
              <td className="p-2 text-xs text-ink/50">{line.fromDishes.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
