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
  packSize: number;
  packSizeUnitLabel: string | null;
  packLabel: string | null;
  unit_price: number | null;
  per_unit_cost: number | null;
  perUnitCostUnitLabel: string | null;
  comments: string | null;
};

function formatPackSize(r: OfferRow): string {
  const size = `${r.packSize} ${r.packSizeUnitLabel ?? ""}`.trim();
  return r.packLabel ? `${r.packLabel} (${size})` : size;
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
      render: (r) => <span className="font-mono text-ink/70">{formatPackSize(r)}</span>,
      exportValue: (r) => formatPackSize(r),
    },
    {
      key: "unit_price",
      label: "Unit price",
      render: (r) => <span className="font-mono text-ink/70">{r.unit_price != null ? `$${r.unit_price}` : "—"}</span>,
      exportValue: (r) => r.unit_price ?? "",
    },
    {
      key: "per_unit_cost",
      label: "Per-unit cost",
      render: (r) => (
        <span className="font-mono text-ink/70">
          {r.per_unit_cost != null ? `$${r.per_unit_cost.toFixed(4)}/${r.perUnitCostUnitLabel ?? ""}` : "—"}
        </span>
      ),
      exportValue: (r) => (r.per_unit_cost != null ? `${r.per_unit_cost.toFixed(4)}/${r.perUnitCostUnitLabel ?? ""}` : ""),
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
    const itemOffers = allOffers
      .filter((o) => o.itemId === row.itemId)
      .sort((a, b) => a.packSize - b.packSize || a.vendorLabel.localeCompare(b.vendorLabel));

    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
          Pack sizes &amp; vendor offers for {row.name}
        </p>
        <ul className="flex flex-col gap-1">
          {itemOffers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-ink/70">{formatPackSize(o)}</span>
              <span className="text-ink/40">—</span>
              <span className="text-ink">{o.vendorLabel}</span>
              {o.brand && <span className="text-xs text-ink/40">({o.brand})</span>}
              <span className="font-mono text-ink/70">{o.unit_price != null ? `$${o.unit_price}` : "—"}</span>
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
