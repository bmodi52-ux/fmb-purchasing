import { TabLink } from "@/components/tab-link";

/**
 * Procurement, in three tabs: what to buy, the lists to take shopping, and
 * the setup behind both — who buys each section, and which list an item is
 * on when its category gets it wrong.
 */
export function ProcurementTabs({
  active,
  canManage,
}: {
  active: "buy" | "lists" | "setup";
  canManage: boolean;
}) {
  return (
    <nav aria-label="Procurement sections" className="flex gap-1 border-b border-ink/10">
      <TabLink href="/procurement" active={active === "buy"}>
        To buy
      </TabLink>
      <TabLink href="/procurement/lists" active={active === "lists"}>
        Shopping lists
      </TabLink>
      {canManage && (
        <TabLink href="/procurement/setup" active={active === "setup"}>
          Who buys what
        </TabLink>
      )}
    </nav>
  );
}
