"use client";

import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { ColumnsDataTable, type ColumnDef, type BulkAction } from "@/components/columns-data-table";
import { formatPackPrice, formatUnitCost, packTitle, type PackDescriptionInput } from "@/lib/pack-description";
import { reviewOffer, bulkReviewOffers } from "./actions";
import { collapseToItems } from "./collapse-offers";

export type OfferRow = {
  id: string;
  itemId: string;
  itemNumber: string | null;
  name: string;
  status: string;
  vendorId: string | null;
  vendorLabel: string;
  /** The item's preferred vendor, whichever offer this row is (#29). */
  preferredVendorLabel: string | null;
  /** Whether this offer is from the item's preferred vendor. */
  isPreferredVendor: boolean;
  /** The lowest price per unit actually paid for the item lately, and who charged it. */
  cheapestRecent: { price: string; vendorLabel: string | null; date: string } | null;
  categoryLabel: string;
  brand: string | null;
  vendorSku: string | null;
  innerQuantity: number;
  innerUnitLabel: string | null;
  packCount: number;
  totalQuantity: number;
  packLabel: string | null;
  soldLoose: boolean;
  /** What the pack comes in — "box". Null when nobody has said. */
  packaging: string | null;
  /** False while nobody has said what one unit holds — cost is then per pack. */
  contentsConfirmed: boolean;
  packPrice: number | null;
  /** Derived by the offer_unit_costs view, expressed in baseUnitCode. */
  costPerBaseUnit: number | null;
  baseUnitCode: string | null;
  comments: string | null;
  /**
   * Set only on a collapsed row: how many further offers this item has that
   * the row is standing in for. Never persisted — see ./collapse-offers.
   */
  otherOfferCount?: number;
};


function shapeOf(r: OfferRow): PackDescriptionInput {
  return {
    innerQuantity: r.innerQuantity,
    unitLabel: r.innerUnitLabel,
    packCount: r.packCount,
    soldLoose: r.soldLoose,
    packaging: r.packaging,
  };
}

function formatPackSize(r: OfferRow): string {
  return packTitle(r.packLabel, shapeOf(r));
}

function formatCostPerUnit(r: OfferRow): string {
  if (r.costPerBaseUnit == null) return "—";
  return formatUnitCost(r.costPerBaseUnit, r.baseUnitCode);
}

function buildColumns(canApprove: boolean): ColumnDef<OfferRow>[] {
  const columns: ColumnDef<OfferRow>[] = [
    {
      key: "item_number",
      label: "Item #",
      // Followable, like Entry # on Expenses and Vendor # on Vendors. Item
      // numbers get written on order sheets and read back here.
      render: (r) => (
        <Link href={`/pricelist/${r.itemId}`} className="font-mono text-ink underline">
          {r.itemNumber ?? "View"}
        </Link>
      ),
      exportValue: (r) => r.itemNumber ?? "",
    },
    {
      key: "name",
      label: "Item",
      render: (r) => (
        <>
          <Link href={`/pricelist/${r.itemId}`} className="text-ink hover:underline">
            {r.name}
          </Link>
          {r.brand && <span className="ml-1 text-xs text-ink/40">({r.brand})</span>}
          {r.otherOfferCount ? (
            <span
              className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink/50"
              title="Showing this item's best offer. Expand the row, or show the Vendor column, to see them all."
            >
              +{r.otherOfferCount} more {r.otherOfferCount === 1 ? "offer" : "offers"}
            </span>
          ) : null}
        </>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: "vendor",
      label: "Vendor",
      render: (r) => (
        <>
          {r.vendorLabel}
          {r.isPreferredVendor && <PreferredBadge />}
        </>
      ),
      exportValue: (r) => r.vendorLabel,
    },
    {
      key: "preferred_vendor",
      label: "Preferred vendor",
      render: (r) => r.preferredVendorLabel ?? <span className="text-ink/40">—</span>,
      exportValue: (r) => r.preferredVendorLabel ?? "",
    },
    { key: "category", label: "Category", render: (r) => r.categoryLabel, exportValue: (r) => r.categoryLabel },
    {
      key: "pack_size",
      label: "Pack size",
      render: (r) => (
        <span className="font-mono text-ink/70">
          {formatPackSize(r)}
          {!r.contentsConfirmed && (
            <Link
              href={`/pricelist/${r.itemId}`}
              title="Nobody has confirmed what's in this pack yet, so cost per unit is per pack"
              className="ml-1 text-gold-deep hover:underline"
            >
              ⚠
            </Link>
          )}
        </span>
      ),
      exportValue: (r) => formatPackSize(r),
    },
    {
      key: "vendor_sku",
      label: "Vendor code",
      render: (r) => <span className="font-mono text-ink/60">{r.vendorSku ?? "—"}</span>,
      exportValue: (r) => r.vendorSku ?? "",
    },
    {
      key: "pack_price",
      label: "Price",
      render: (r) => (
        <span className="font-mono text-ink/70">
          {r.packPrice != null ? formatPackPrice(r.packPrice, shapeOf(r)) : "—"}
        </span>
      ),
      exportValue: (r) => r.packPrice ?? "",
    },
    {
      key: "cost_per_unit",
      label: "Per unit",
      render: (r) => (
        <span className={`font-mono ${r.contentsConfirmed ? "text-ink/70" : "text-ink/40 italic"}`}>
          {formatCostPerUnit(r)}
        </span>
      ),
      exportValue: (r) =>
        r.costPerBaseUnit != null
          ? `${formatUnitCost(r.costPerBaseUnit, r.baseUnitCode, { currency: false })}${r.contentsConfirmed ? "" : " (provisional)"}`
          : "",
    },
    {
      key: "cheapest_recent",
      label: "Cheapest recently",
      render: (r) =>
        r.cheapestRecent ? (
          <span title={`Paid on ${r.cheapestRecent.date}`}>
            <span className="font-mono text-ink/70">{r.cheapestRecent.price}</span>
            {r.cheapestRecent.vendorLabel && <span className="block text-xs text-ink/50">{r.cheapestRecent.vendorLabel}</span>}
          </span>
        ) : (
          <span className="text-ink/40">—</span>
        ),
      exportValue: (r) =>
        r.cheapestRecent ? `${r.cheapestRecent.price}${r.cheapestRecent.vendorLabel ? ` (${r.cheapestRecent.vendorLabel})` : ""}` : "",
    },
    { key: "comments", label: "Comments", render: (r) => r.comments || "—", exportValue: (r) => r.comments ?? "" },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  if (canApprove) {
    columns.push({
      key: "actions",
      label: "",
      render: (r) =>
        r.status === "pending" ? (
          <div className="flex gap-2">
            <form action={reviewOffer}>
              <input type="hidden" name="offer_id" value={r.id} />
              <input type="hidden" name="decision" value="approved" />
              <SubmitButton className="text-xs text-palm hover:underline">
                Approve
              </SubmitButton>
            </form>
            <form action={reviewOffer}>
              <input type="hidden" name="offer_id" value={r.id} />
              <input type="hidden" name="decision" value="rejected" />
              <SubmitButton className="text-xs text-maroon/70 hover:underline">
                Reject
              </SubmitButton>
            </form>
          </div>
        ) : null,
      exportValue: () => "",
    });
  }

  return columns;
}

export function ItemsTable({
  rows,
  allOffers,
  canApprove,
  initialVisible,
  emptyLabel,
  collapseByItem = false,
}: {
  rows: OfferRow[];
  /** Every offer on the page, across both the pending and approved sections — used to show an
   * item's full pack-size/offer breakdown inline, regardless of which section this row is in. */
  allOffers: OfferRow[];
  canApprove: boolean;
  initialVisible: string[];
  emptyLabel?: string;
  /**
   * Collapse to one row per item when the Vendor column is hidden.
   *
   * Off for the pending-review table, where approving is per offer: a
   * collapsed row would put Approve and Reject next to one offer standing in
   * for several, and it would not be clear which was being decided.
   */
  collapseByItem?: boolean;
}) {
  const bulkActions: BulkAction<OfferRow>[] | undefined = canApprove
    ? [
        {
          label: "Approve selected",
          onClick: (selected) => bulkReviewOffers(selected.map((r) => r.id), "approved"),
        },
        {
          label: "Reject selected",
          variant: "danger",
          onClick: (selected) => bulkReviewOffers(selected.map((r) => r.id), "rejected"),
        },
      ]
    : undefined;

  function renderExpanded(row: OfferRow) {
    // Cheapest per base unit first — the comparison the expand exists to make.
    const itemOffers = allOffers
      .filter((o) => o.itemId === row.itemId)
      .sort(
        (a, b) =>
          (a.costPerBaseUnit ?? Infinity) - (b.costPerBaseUnit ?? Infinity) ||
          a.vendorLabel.localeCompare(b.vendorLabel)
      );

    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
          Pack sizes &amp; vendor offers for {row.name}
        </p>
        <ul className="flex flex-col gap-1">
          {itemOffers.map((o, index) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-ink/70">{formatPackSize(o)}</span>
              <span className="text-ink/40">—</span>
              <span className="text-ink">{o.vendorLabel}</span>
              {o.brand && <span className="text-xs text-ink/40">({o.brand})</span>}
              <span className="font-mono text-ink/70">{o.packPrice != null ? `$${o.packPrice}` : "—"}</span>
              <span className="font-mono text-ink/50">{formatCostPerUnit(o)}</span>
              {index === 0 && o.costPerBaseUnit != null && itemOffers.length > 1 && (
                <span className="rounded-full bg-palm/15 px-2 py-0.5 text-xs text-palm">cheapest</span>
              )}
              {o.isPreferredVendor && <PreferredBadge />}
              <StatusBadge status={o.status} />
            </li>
          ))}
        </ul>
        {row.cheapestRecent && (
          <p className="text-xs text-ink/55">
            Cheapest actually paid lately: {row.cheapestRecent.price}
            {row.cheapestRecent.vendorLabel ? ` from ${row.cheapestRecent.vendorLabel}` : ""}
          </p>
        )}
        <Link href={`/pricelist/${row.itemId}`} className="text-xs text-ink/60 underline">
          Open full item page →
        </Link>
      </div>
    );
  }

  return (
    <ColumnsDataTable
      pageKey="pricelist"
      title="Pricelist"
      columns={buildColumns(canApprove)}
      rows={rows}
      initialVisible={initialVisible}
      emptyLabel={emptyLabel}
      bulkActions={bulkActions}
      renderExpanded={renderExpanded}
      deriveRows={collapseByItem ? collapseToItems : undefined}
    />
  );
}

function PreferredBadge() {
  return <span className="ml-1.5 rounded-full bg-gold/20 px-2 py-0.5 text-xs text-gold-deep">preferred</span>;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "approved" ? "text-palm" : status === "rejected" ? "text-maroon/70" : "text-gold-deep";
  return <span className={color}>{status}</span>;
}
