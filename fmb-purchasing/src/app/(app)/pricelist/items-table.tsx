"use client";

import Link from "next/link";
import { ColumnsDataTable, type ColumnDef, type BulkAction } from "@/components/columns-data-table";
import { reviewOffer, bulkReviewOffers } from "./actions";

export type OfferRow = {
  id: string;
  itemId: string;
  itemNumber: string | null;
  name: string;
  status: string;
  vendorLabel: string;
  categoryLabel: string;
  brand: string | null;
  vendorSku: string | null;
  innerQuantity: number;
  innerUnitLabel: string | null;
  packCount: number;
  totalQuantity: number;
  packLabel: string | null;
  soldLoose: boolean;
  /** False while nobody has said what one unit holds — cost is then per pack. */
  contentsConfirmed: boolean;
  packPrice: number | null;
  /** Derived by the offer_unit_costs view, expressed in baseUnitCode. */
  costPerBaseUnit: number | null;
  baseUnitCode: string | null;
  comments: string | null;
};

/** "1 L × 10 (10 L)" for a carton, "Loose (per kg)" when bought by weight. */
function formatPackSize(r: OfferRow): string {
  const unit = r.innerUnitLabel ?? "";
  const shape =
    r.soldLoose && r.packCount === 1 && Number(r.innerQuantity) === 1
      ? `Loose (per ${unit})`.trim()
      : r.packCount > 1
        ? `${r.innerQuantity} ${unit} × ${r.packCount} (${r.totalQuantity} ${unit})`
        : `${r.innerQuantity} ${unit}`.trim();
  return r.packLabel ? `${r.packLabel} — ${shape}` : shape;
}

function formatCostPerUnit(r: OfferRow): string {
  if (r.costPerBaseUnit == null) return "—";
  return `$${r.costPerBaseUnit.toFixed(4)}/${r.baseUnitCode ?? ""}`;
}

function buildColumns(canApprove: boolean): ColumnDef<OfferRow>[] {
  const columns: ColumnDef<OfferRow>[] = [
    {
      key: "item_number",
      label: "Item #",
      render: (r) => <span className="font-mono text-ink/60">{r.itemNumber ?? "—"}</span>,
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
        </>
      ),
      exportValue: (r) => r.name,
    },
    { key: "vendor", label: "Vendor", render: (r) => r.vendorLabel, exportValue: (r) => r.vendorLabel },
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
              title="Nobody has said what one unit contains, so cost per unit is per pack"
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
      label: "Pack price",
      render: (r) => <span className="font-mono text-ink/70">{r.packPrice != null ? `$${r.packPrice}` : "—"}</span>,
      exportValue: (r) => r.packPrice ?? "",
    },
    {
      key: "cost_per_unit",
      label: "Cost per unit",
      render: (r) => (
        <span className={`font-mono ${r.contentsConfirmed ? "text-ink/70" : "text-ink/40 italic"}`}>
          {formatCostPerUnit(r)}
        </span>
      ),
      exportValue: (r) =>
        r.costPerBaseUnit != null
          ? `${r.costPerBaseUnit.toFixed(4)}/${r.baseUnitCode ?? ""}${r.contentsConfirmed ? "" : " (provisional)"}`
          : "",
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
              <button type="submit" className="text-xs text-palm hover:underline">
                Approve
              </button>
            </form>
            <form action={reviewOffer}>
              <input type="hidden" name="offer_id" value={r.id} />
              <input type="hidden" name="decision" value="rejected" />
              <button type="submit" className="text-xs text-maroon/70 hover:underline">
                Reject
              </button>
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
}: {
  rows: OfferRow[];
  /** Every offer on the page, across both the pending and approved sections — used to show an
   * item's full pack-size/offer breakdown inline, regardless of which section this row is in. */
  allOffers: OfferRow[];
  canApprove: boolean;
  initialVisible: string[];
  emptyLabel?: string;
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
              <StatusBadge status={o.status} />
            </li>
          ))}
        </ul>
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
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "approved" ? "text-palm" : status === "rejected" ? "text-maroon/70" : "text-gold-deep";
  return <span className={color}>{status}</span>;
}
