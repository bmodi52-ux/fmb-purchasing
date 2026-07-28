"use client";

import { useEffect, useState } from "react";
import { AddItemForm } from "./add-item-form";

type Vendor = { id: string; name: string; vendor_number: string | null };
type Category = { id: string; name: string };
type Unit = { id: string; code: string; label: string };

export function AddItemModal({
  vendors,
  categories,
  units,
}: {
  vendors: Vendor[];
  categories: Category[];
  units: Unit[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-gold px-4 py-2 font-medium text-ink transition-colors hover:bg-gold-deep"
      >
        + Add item
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 py-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-lg border border-ink/10 bg-cream p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title text-ink">Add item</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink/40 hover:text-ink"
              >
                ×
              </button>
            </div>
            <AddItemForm
              vendors={vendors}
              categories={categories}
              units={units}
              onSuccess={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
