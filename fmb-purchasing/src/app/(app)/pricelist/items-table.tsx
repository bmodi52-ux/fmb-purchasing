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
  canApprove,
  initialVisible,
  emptyLabel,
}: {
  rows: OfferRow[];
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

  return (
    <ColumnsDataTable
      pageKey="pricelist"
      title="Pricelist"
      columns={buildColumns(canApprove)}
      rows={rows}
      initialVisible={initialVisible}
      emptyLabel={emptyLabel}
      bulkActions={bulkActions}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "approved" ? "text-palm" : status === "rejected" ? "text-maroon/70" : "text-gold-deep";
  return <span className={color}>{status}</span>;
}
