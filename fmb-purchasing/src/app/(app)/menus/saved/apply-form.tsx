import { applySavedMenu } from "./actions";
import { DayPicker } from "./day-picker";

/**
 * Put a menu on days (#20): which kitchen, which days, and what to do with a
 * picked day that already has a menu.
 */
export function ApplyForm({
  savedMenuId,
  kitchens,
  defaultKitchenId,
  planned,
  today,
}: {
  savedMenuId: string;
  kitchens: { id: string; name: string }[];
  defaultKitchenId?: string;
  planned: Record<string, string[]>;
  today: string;
}) {
  return (
    <form action={applySavedMenu} className="flex flex-col gap-4">
      <input type="hidden" name="saved_menu_id" value={savedMenuId} />

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Kitchen</span>
          <select name="kitchen" defaultValue={defaultKitchenId ?? kitchens[0]?.id} className="input">
            {kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            {kitchens.length > 1 && <option value="all">Both kitchens</option>}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-ink/70">If a day already has a menu</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing" value="skip" defaultChecked /> Leave it as it is
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing" value="add" /> Add this menu to it
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing" value="replace" /> Replace it
            <span className="text-xs text-ink/45">(not on a day somebody has already bought for)</span>
          </label>
        </fieldset>
      </div>

      <DayPicker today={today} planned={planned} maxDays={62} />
    </form>
  );
}
