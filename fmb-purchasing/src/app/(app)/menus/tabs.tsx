import { TabLink } from "@/components/tab-link";

/**
 * Menus, in two tabs: the calendar and the dishes it is built from.
 *
 * They were two entries in the sidebar, which read as two features. A dish
 * exists only to go on a menu, so it belongs inside the same page — as the
 * vendor and item pages already do it.
 */
export function MenuTabs({ active }: { active: "calendar" | "dishes" }) {
  return (
    <nav aria-label="Menus sections" className="flex gap-1 border-b border-ink/10">
      <TabLink href="/menus" active={active === "calendar"}>
        Calendar
      </TabLink>
      <TabLink href="/menus/dishes" active={active === "dishes"}>
        Dishes
      </TabLink>
    </nav>
  );
}
