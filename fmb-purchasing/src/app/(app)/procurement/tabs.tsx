import { TabLink } from "@/components/tab-link";

/**
 * Procurement, in four tabs: what to buy, the lists to take shopping, the
 * monthly stock count (#10), and the setup behind the lists — who buys each
 * section, and which list an item is on when its category gets it wrong.
 */
export function ProcurementTabs({
  active,
  canManage,
}: {
  active: "buy" | "lists" | "stock" | "setup";
  canManage: boolean;
}) {
  return (
    <nav aria-label="Procurement sections" className="flex flex-wrap gap-x-1 border-b border-ink/10">
      <TabLink href="/procurement" active={active === "buy"}>
        To buy
      </TabLink>
      <TabLink href="/procurement/lists" active={active === "lists"}>
        Shopping lists
      </TabLink>
      <TabLink href="/procurement/stock" active={active === "stock"}>
        Stock count
      </TabLink>
      {canManage && (
        <TabLink href="/procurement/setup" active={active === "setup"}>
          Who buys what
        </TabLink>
      )}
    </nav>
  );
}
