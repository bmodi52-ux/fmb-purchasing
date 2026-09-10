import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { reviewOffer } from "../../pricelist/actions";

export type VendorProductRow = {
  offerId: string;
  status: string;
  itemId: string;
  itemName: string;
  itemNumber: string | null;
  packTitle: string;
  /** "$40.00 per box", or null when no price has been entered. */
  price: string | null;
  /** "$6.6667/kg", or null when it cannot be worked out. */
  perUnit: string | null;
  brand: string | null;
  vendorSku: string | null;
  purchaseCount: number;
  lastBought: string | null;
};

/**
 * What a vendor supplies, on the vendor's page.
 *
 * The link between a vendor and a product only ever lived on the product: to
 * see what a supplier carries, somebody had to open item after item looking for
 * the vendor's name. Every offer this vendor has is listed here instead, with
 * its price, what it works out to per unit, and whether it has actually been
 * bought — the difference between a quote and a supplier.
 */
export function VendorProducts({
  vendorName,
  rows,
  canViewPricelist,
  canApprove,
  actions,
}: {
  vendorName: string;
  rows: VendorProductRow[];
  canViewPricelist: boolean;
  canApprove: boolean;
  /** Adding items and pricing, for whoever may edit the Pricelist. */
  actions: React.ReactNode;
}) {
  const live = rows.filter((r) => r.status !== "rejected");
  const rejected = rows.filter((r) => r.status === "rejected");

  return (
    <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="section-title text-ink">Products</h2>
          <p className="mt-1 text-sm text-ink/55">
            What {vendorName} supplies: every item and pack size with pricing from them, and how often it has been
            bought.
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {live.length === 0 ? (
        <p className="text-sm text-ink/50">
          No products recorded for {vendorName} yet.{" "}
          {actions
            ? "Add a new item, or add pricing for one already on the Pricelist."
            : "They appear once a receipt from this vendor has been submitted."}
        </p>
      ) : (
        <ProductTable rows={live} canViewPricelist={canViewPricelist} canApprove={canApprove} />
      )}

      {/* Kept rather than hidden for good: a rejected offer is a price somebody
          decided against, and the purchases filed against it still point at it. */}
      {rejected.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink/50 hover:text-ink">{rejected.length} rejected</summary>
          <div className="mt-2">
            <ProductTable rows={rejected} canViewPricelist={canViewPricelist} canApprove={false} />
          </div>
        </details>
      )}
    </section>
  );
}

function ProductTable({
  rows,
  canViewPricelist,
  canApprove,
}: {
  rows: VendorProductRow[];
  canViewPricelist: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink/50">
            <th scope="col" className="py-1.5 pr-3 font-medium">Item</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Pack size</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Price</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Per unit</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Bought</th>
            <th scope="col" className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.offerId} className="border-t border-ink/5 align-top">
              <td className="py-2 pr-3">
                {canViewPricelist ? (
                  <Link href={`/pricelist/${r.itemId}`} className="text-ink hover:underline">
                    {r.itemName}
                  </Link>
                ) : (
                  <span className="text-ink">{r.itemName}</span>
                )}
                {r.itemNumber && <span className="ml-1.5 font-mono text-xs text-ink/45">{r.itemNumber}</span>}
                {(r.brand || r.vendorSku) && (
                  <p className="text-xs text-ink/45">
                    {[r.brand, r.vendorSku ? `#${r.vendorSku}` : null].filter(Boolean).join(" · ")}
                  </p>
                )}
              </td>
              <td className="py-2 pr-3 text-ink/75">{r.packTitle}</td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono">
                {r.price ?? <span className="font-sans text-gold-deep">no price yet</span>}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-ink/60">{r.perUnit ?? "—"}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-ink/60">
                {r.purchaseCount > 0
                  ? `${r.purchaseCount} time${r.purchaseCount === 1 ? "" : "s"}${r.lastBought ? `, last ${r.lastBought}` : ""}`
                  : "Not yet"}
              </td>
              <td className="whitespace-nowrap py-2">
                {r.status === "pending" && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gold-deep">pending</span>
                    {canApprove && (
                      <>
                        <form action={reviewOffer}>
                          <input type="hidden" name="offer_id" value={r.offerId} />
                          <input type="hidden" name="decision" value="approved" />
                          <SubmitButton className="text-xs text-palm hover:underline">Approve</SubmitButton>
                        </form>
                        <form action={reviewOffer}>
                          <input type="hidden" name="offer_id" value={r.offerId} />
                          <input type="hidden" name="decision" value="rejected" />
                          <SubmitButton className="text-xs text-maroon/70 hover:underline">Reject</SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
