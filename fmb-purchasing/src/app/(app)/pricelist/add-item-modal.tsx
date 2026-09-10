"use client";

import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { AddItemForm } from "./add-item-form";

type Vendor = { id: string; name: string; vendor_number: string | null };
type Category = { id: string; name: string };
type Unit = { id: string; code: string; label: string };

export function AddItemModal({
  vendors,
  categories,
  units,
  label = "+ Add item",
  fixedVendor,
}: {
  vendors: Vendor[];
  categories: Category[];
  units: Unit[];
  label?: string;
  /** Opened from a vendor's page: the first offer is that vendor's. */
  fixedVendor?: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start whitespace-nowrap rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep"
      >
        {label}
      </button>

      {/* Escape, the backdrop, focus trapping and focus restore all live in
          Dialog — this used to handle only the first of those. */}
      {open && (
        <Dialog
          title={fixedVendor ? `New item from ${fixedVendor.name}` : "Add item"}
          align="start"
          onClose={() => setOpen(false)}
        >
          <AddItemForm
            vendors={vendors}
            categories={categories}
            units={units}
            fixedVendor={fixedVendor}
            onSuccess={() => setOpen(false)}
          />
        </Dialog>
      )}
    </>
  );
}
