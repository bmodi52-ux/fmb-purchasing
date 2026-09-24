import { TabLink } from "@/components/tab-link";

/**
 * Menus, in five tabs: the calendar, the sheet of days side by side, the
 * dishes they are built from, menus saved to use again (#17), and what it
 * has all cost (#15).
 *
 * They were two entries in the sidebar, which read as two features. A dish
 * exists only to go on a menu, so it belongs inside the same page — as the
 * vendor and item pages already do it.
 */
export function MenuTabs({ active }: { active: "calendar" | "sheet" | "dishes" | "saved" | "costs" }) {
  return (
    <nav aria-label="Thaali Calendar sections" className="tabs">
      <TabLink href="/menus" active={active === "calendar"}>
        Calendar
      </TabLink>
      <TabLink href="/menus/sheet" active={active === "sheet"}>
        Sheet
      </TabLink>
      <TabLink href="/menus/dishes" active={active === "dishes"}>
        Dishes
      </TabLink>
      <TabLink href="/menus/saved" active={active === "saved"}>
        Saved menus
      </TabLink>
      <TabLink href="/menus/costs" active={active === "costs"}>
        Costs
      </TabLink>
    </nav>
  );
}
