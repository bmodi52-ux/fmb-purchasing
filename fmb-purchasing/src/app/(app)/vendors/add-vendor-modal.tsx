"use client";

import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { AddVendorForm } from "./add-vendor-form";

export function AddVendorModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start whitespace-nowrap rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep"
      >
        + Add vendor
      </button>

      {/* Escape, the backdrop, focus trapping and focus restore all live in
          Dialog — this used to handle only the first of those. */}
      {open && (
        <Dialog title="Add vendor" align="start" onClose={() => setOpen(false)}>
          <AddVendorForm onSuccess={() => setOpen(false)} />
        </Dialog>
      )}
    </>
  );
}
