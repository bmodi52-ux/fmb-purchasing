import { TabLink } from "@/components/tab-link";

/**
 * Menus, in three tabs: the calendar, the sheet of days side by side, and
 * the dishes they are built from.
 *
 * They were two entries in the sidebar, which read as two features. A dish
 * exists only to go on a menu, so it belongs inside the same page — as the
 * vendor and item pages already do it.
 */
export function MenuTabs({ active }: { active: "calendar" | "sheet" | "dishes" }) {
  return (
    <nav aria-label="Thaali Calendar sections" className="flex gap-1 border-b border-ink/10">
      <TabLink href="/menus" active={active === "calendar"}>
        Calendar
      </TabLink>
      <TabLink href="/menus/sheet" active={active === "sheet"}>
        Sheet
      </TabLink>
      <TabLink href="/menus/dishes" active={active === "dishes"}>
        Dishes
      </TabLink>
    </nav>
  );
}
