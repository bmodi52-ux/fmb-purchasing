"use client";

import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { ColumnsDataTable, type ColumnDef, type BulkAction } from "@/components/columns-data-table";
import { reviewVendor, bulkReviewVendors } from "./actions";

export type VendorRow = {
  id: string;
  vendor_number: string | null;
  name: string;
  abn: string | null;
  status: string;
  billingSummary: string;
  contactSummary: string;
};

function buildColumns(canApprove: boolean): ColumnDef<VendorRow>[] {
  const columns: ColumnDef<VendorRow>[] = [
    {
      key: "vendor_number",
      label: "Vendor #",
      render: (v) => <span className="font-mono text-ink/60">{v.vendor_number ?? "—"}</span>,
      exportValue: (v) => v.vendor_number ?? "",
    },
    {
      key: "name",
      label: "Name",
      render: (v) => (
        <Link href={`/vendors/${v.id}`} className="text-ink hover:underline">
          {v.name}
        </Link>
      ),
      exportValue: (v) => v.name,
    },
    {
      key: "abn",
      label: "ABN",
      render: (v) => <span className="font-mono text-ink/70">{v.abn || "—"}</span>,
      exportValue: (v) => v.abn ?? "",
    },
    { key: "billing_address", label: "Billing address", render: (v) => v.billingSummary || "—", exportValue: (v) => v.billingSummary },
    { key: "contact", label: "Contact", render: (v) => v.contactSummary || "—", exportValue: (v) => v.contactSummary },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v.status} />, exportValue: (v) => v.status },
  ];

  if (canApprove) {
    columns.push({
      key: "actions",
      label: "",
      render: (v) =>
        v.status === "pending" ? (
          <div className="flex gap-2">
            <form action={reviewVendor}>
              <input type="hidden" name="vendor_id" value={v.id} />
              <input type="hidden" name="decision" value="approved" />
              <SubmitButton className="text-xs text-palm hover:underline">
                Approve
              </SubmitButton>
            </form>
            <form action={reviewVendor}>
              <input type="hidden" name="vendor_id" value={v.id} />
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

export function VendorsTable({
  vendors,
  canApprove,
  initialVisible,
  emptyLabel,
}: {
  vendors: VendorRow[];
  canApprove: boolean;
  initialVisible: string[];
  emptyLabel?: string;
}) {
  const bulkActions: BulkAction<VendorRow>[] | undefined = canApprove
    ? [
        {
          label: "Approve selected",
          onClick: (selected) => bulkReviewVendors(selected.map((v) => v.id), "approved"),
        },
        {
          label: "Reject selected",
          variant: "danger",
          onClick: (selected) => bulkReviewVendors(selected.map((v) => v.id), "rejected"),
        },
      ]
    : undefined;

  return (
    <ColumnsDataTable
      pageKey="vendors"
      title="Vendors"
      columns={buildColumns(canApprove)}
      rows={vendors}
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
