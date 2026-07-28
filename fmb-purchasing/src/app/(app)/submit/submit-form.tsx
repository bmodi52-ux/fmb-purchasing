"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extractReceiptAction,
  lookupAbnAction,
  uploadReceiptFileAction,
  createExpense,
  updateExpense,
  type ExtractState,
  type UploadFileState,
  type LineItemInput,
  type ItemLookupSuggestion,
  type ExpenseForEdit,
} from "./actions";
import type { ExtractedReceipt } from "@/lib/receipt-extraction";
import { VendorLookupFields } from "./vendor-lookup-fields";
import { ItemLookupCells } from "./item-lookup-cells";

const initialExtractState: ExtractState = { data: null, receiptPath: null, error: null };
const initialUploadState: UploadFileState = { path: null, fileName: null, error: null };

type ReviewItem = LineItemInput & { key: string; itemNumber: string };

function toReviewItems(items: ExtractedReceipt["lineItems"]): ReviewItem[] {
  return items.map((item, i) => ({
    key: `${i}-${Date.now()}`,
    itemNumber: "",
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal ?? (item.quantity && item.unitPrice ? round2(item.quantity * item.unitPrice) : 0),
    categoryName: item.category,
    normalizedQuantity: item.normalizedQuantity,
    normalizedUnit: item.normalizedUnit,
  }));
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function blankItem(): ReviewItem {
  return {
    key: String(Math.random()),
    itemNumber: "",
    description: "",
    quantity: null,
    unitPrice: null,
    lineTotal: 0,
    categoryName: null,
    normalizedQuantity: null,
    normalizedUnit: null,
  };
}

export function SubmitForm({
  categories,
  vendorNames,
  editExpense,
}: {
  categories: string[];
  vendorNames: string[];
  editExpense?: ExpenseForEdit | null;
}) {
  const router = useRouter();
  const [extractState, extractAction, extracting] = useActionState(
    extractReceiptAction,
    initialExtractState
  );
  const [mode, setMode] = useState<"start" | "review">(editExpense ? "review" : "start");
  const [receiptPath, setReceiptPath] = useState<string | null>(editExpense?.receiptPath ?? null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);

  const [vendorName, setVendorName] = useState(editExpense?.vendorName ?? "");
  const [vendorNumber, setVendorNumber] = useState("");
  const [abn, setAbn] = useState(editExpense?.abn ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(editExpense?.invoiceNumber ?? "");
  const [receiptDate, setReceiptDate] = useState(editExpense?.receiptDate ?? "");
  const [total, setTotal] = useState(editExpense?.total ?? 0);
  const [subtotal, setSubtotal] = useState(editExpense?.subtotal ?? 0);
  const [gstAmount, setGstAmount] = useState(editExpense?.gstAmount ?? 0);
  const [items, setItems] = useState<ReviewItem[]>(() =>
    editExpense
      ? editExpense.lineItems.map((it, i) => ({ ...it, key: `edit-${i}`, itemNumber: "" }))
      : []
  );

  // Populates local form state from the AI-extraction server action's
  // result — an external system, not a derivable value — so an effect is
  // the right tool.
  useEffect(() => {
    if (extractState.data) {
      const d = extractState.data;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVendorName(d.vendor ?? "");
      setAbn(d.abn ?? "");
      setInvoiceNumber(d.invoiceNumber ?? "");
      setReceiptDate(normalizeDateInput(d.date));
      const reviewItems = toReviewItems(d.lineItems);
      setItems(reviewItems.length ? reviewItems : [blankItem()]);
      const computedTotal = d.total ?? reviewItems.reduce((s, it) => s + (it.lineTotal || 0), 0);
      // If the AI couldn't determine a GST breakdown, assume prices are
      // GST-inclusive (standard 10% AU GST) rather than GST-free.
      const computedGst = d.gstAmount ?? round2(computedTotal / 11);
      setTotal(round2(computedTotal));
      setSubtotal(round2(d.subtotal ?? computedTotal - computedGst));
      setGstAmount(round2(computedGst));
      setReceiptPath(extractState.receiptPath);
      setMode("review");
    } else if (extractState.receiptPath && extractState.error) {
      // extraction failed but the file uploaded fine — fall back to a blank manual form
      setReceiptPath(extractState.receiptPath);
      setItems([blankItem()]);
      setMode("review");
    }
  }, [extractState]);

  function startManual() {
    setVendorName("");
    setVendorNumber("");
    setAbn("");
    setInvoiceNumber("");
    setReceiptDate("");
    setTotal(0);
    setSubtotal(0);
    setGstAmount(0);
    setItems([blankItem()]);
    setReceiptPath(null);
    setReceiptFileName(null);
    setMode("review");
  }

  if (mode === "start") {
    return (
      <div className="flex flex-col gap-4">
        <form action={extractAction} className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-ink/20 bg-white/50 p-8 text-center">
          <label className="cursor-pointer">
            <input type="file" name="file" accept="image/*,application/pdf" required className="hidden" onChange={(e) => e.target.form?.requestSubmit()} />
            <span className="section-title text-ink">Upload or scan a receipt</span>
            <p className="mt-1 text-sm text-ink/60">JPG, PNG, WebP, or PDF. Tap to choose a file.</p>
          </label>
          {extracting && <p className="font-mono text-sm text-ink/60">Reading receipt…</p>}
          {extractState.error && !extracting && (
            <p className="text-sm text-red-700">{extractState.error}</p>
          )}
        </form>
        <button
          type="button"
          onClick={startManual}
          className="self-start text-sm text-ink/60 underline hover:text-ink"
        >
          Enter details manually instead
        </button>
      </div>
    );
  }

  return (
    <ReviewForm
      categories={categories}
      vendorNames={vendorNames}
      vendorName={vendorName}
      setVendorName={setVendorName}
      vendorNumber={vendorNumber}
      setVendorNumber={setVendorNumber}
      abn={abn}
      setAbn={setAbn}
      invoiceNumber={invoiceNumber}
      setInvoiceNumber={setInvoiceNumber}
      receiptDate={receiptDate}
      setReceiptDate={setReceiptDate}
      items={items}
      setItems={setItems}
      subtotal={subtotal}
      setSubtotal={setSubtotal}
      gstAmount={gstAmount}
      setGstAmount={setGstAmount}
      total={total}
      setTotal={setTotal}
      receiptPath={receiptPath}
      setReceiptPath={setReceiptPath}
      receiptFileName={receiptFileName}
      setReceiptFileName={setReceiptFileName}
      extractionNote={extractState.error && receiptPath ? extractState.error : null}
      onDiscard={() => (editExpense ? router.push("/my-submissions") : setMode("start"))}
      editExpenseId={editExpense?.id ?? null}
    />
  );
}

function normalizeDateInput(raw: string | null): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function ReviewForm(props: {
  categories: string[];
  vendorNames: string[];
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorNumber: string;
  setVendorNumber: (v: string) => void;
  abn: string;
  setAbn: (v: string) => void;
  invoiceNumber: string;
  setInvoiceNumber: (v: string) => void;
  receiptDate: string;
  setReceiptDate: (v: string) => void;
  items: ReviewItem[];
  setItems: React.Dispatch<React.SetStateAction<ReviewItem[]>>;
  subtotal: number;
  setSubtotal: (v: number) => void;
  gstAmount: number;
  setGstAmount: (v: number) => void;
  total: number;
  setTotal: (v: number) => void;
  receiptPath: string | null;
  setReceiptPath: (v: string | null) => void;
  receiptFileName: string | null;
  setReceiptFileName: (v: string | null) => void;
  extractionNote: string | null;
  onDiscard: () => void;
  editExpenseId: string | null;
}) {
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();
  const [lookingUpAbn, startAbnLookup] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploadState, uploadAction, uploading] = useActionState(uploadReceiptFileAction, initialUploadState);

  useEffect(() => {
    if (uploadState.path) {
      props.setReceiptPath(uploadState.path);
      props.setReceiptFileName(uploadState.fileName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState]);

  function updateItem(key: string, patch: Partial<ReviewItem>) {
    props.setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const next = { ...it, ...patch };
        if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
          if (next.quantity != null && next.unitPrice != null) {
            next.lineTotal = round2(next.quantity * next.unitPrice);
          }
        }
        return next;
      })
    );
  }

  function selectItemSuggestion(key: string, s: ItemLookupSuggestion) {
    updateItem(key, {
      categoryName: s.categoryName ?? undefined,
    });
  }

  useEffect(() => {
    const sum = round2(props.items.reduce((s, it) => s + (it.lineTotal || 0), 0));
    props.setTotal(sum);
    props.setSubtotal(round2(sum - props.gstAmount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.items]);

  function handleAbnLookup() {
    setError(null);
    startAbnLookup(async () => {
      const result = await lookupAbnAction(props.abn);
      if ("error" in result) setError(result.error);
      else props.setVendorName(result.name);
    });
  }

  function handleSubmit() {
    setError(null);
    if (!props.vendorName.trim()) {
      setError("Vendor is required.");
      return;
    }
    startSubmit(async () => {
      const payload = {
        vendorName: props.vendorName,
        abn: props.abn || null,
        invoiceNumber: props.invoiceNumber || null,
        receiptDate: props.receiptDate || null,
        receiptPath: props.receiptPath,
        subtotal: props.subtotal,
        gstAmount: props.gstAmount,
        total: props.total,
        lineItems: props.items
          .filter((it) => it.description.trim())
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ key: _key, itemNumber: _itemNumber, ...rest }) => rest),
      };
      const result = props.editExpenseId
        ? await updateExpense(props.editExpenseId, payload)
        : await createExpense(payload);
      if ("error" in result) setError(result.error);
      else router.push("/my-submissions");
    });
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 p-6">
      <h2 className="section-title text-ink">Review details</h2>
      <p className="mb-5 text-sm text-ink/60">Check and correct anything before submitting.</p>

      {props.extractionNote && (
        <p className="mb-4 rounded-md bg-gold/10 px-3 py-2 text-sm text-ink/70">{props.extractionNote}</p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-ink/20 p-3 text-sm">
        <span className="text-ink/70">Receipt:</span>
        {props.receiptPath ? (
          <>
            <span className="text-ink">{props.receiptFileName ?? "attached"} ✓</span>
            <button
              type="button"
              onClick={() => {
                props.setReceiptPath(null);
                props.setReceiptFileName(null);
              }}
              className="text-xs text-maroon/70 hover:underline"
            >
              remove
            </button>
          </>
        ) : (
          <form action={uploadAction} className="flex flex-wrap items-center gap-2">
            <input type="file" name="file" accept="image/*,application/pdf" className="min-w-0 max-w-full text-xs" />
            <button
              type="submit"
              disabled={uploading}
              className="rounded-md border border-ink/15 px-3 py-1 text-xs hover:border-ink/30 disabled:opacity-60"
            >
              {uploading ? "Attaching…" : "Attach"}
            </button>
          </form>
        )}
        {!props.receiptPath && <span className="text-xs text-ink/40">Optional — never required.</span>}
        {uploadState.error && <span className="text-xs text-red-700">{uploadState.error}</span>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <VendorLookupFields
          vendorName={props.vendorName}
          setVendorName={props.setVendorName}
          vendorNumber={props.vendorNumber}
          setVendorNumber={props.setVendorNumber}
        />
        <Field label="Date">
          <input
            type="date"
            value={props.receiptDate}
            onChange={(e) => props.setReceiptDate(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2"
          />
        </Field>
        <Field label="Invoice / receipt no.">
          <input
            value={props.invoiceNumber}
            onChange={(e) => props.setInvoiceNumber(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2"
          />
        </Field>
        <Field label="ABN">
          <div className="flex gap-2">
            <input
              value={props.abn}
              onChange={(e) => props.setAbn(e.target.value)}
              className="flex-1 rounded-md border border-ink/15 bg-white px-3 py-2"
            />
            <button
              type="button"
              onClick={handleAbnLookup}
              disabled={lookingUpAbn}
              className="whitespace-nowrap rounded-md border border-ink/15 px-3 py-2 text-sm hover:border-ink/30 disabled:opacity-60"
            >
              {lookingUpAbn ? "Looking up…" : "Look up vendor"}
            </button>
          </div>
        </Field>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/50">
              <th className="p-1">Item #</th>
              <th className="p-1">Description</th>
              <th className="p-1">Category</th>
              <th className="p-1">Qty</th>
              <th className="p-1">Unit price</th>
              <th className="p-1">Line total</th>
              <th className="p-1">Per-unit</th>
              <th className="p-1" />
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr key={item.key} className="border-t border-ink/5">
                <ItemLookupCells
                  itemNumber={item.itemNumber}
                  setItemNumber={(v) => updateItem(item.key, { itemNumber: v })}
                  description={item.description}
                  setDescription={(v) => updateItem(item.key, { description: v })}
                  onSelect={(s) => selectItemSuggestion(item.key, s)}
                />
                <td className="p-1">
                  <select
                    value={item.categoryName ?? ""}
                    onChange={(e) => updateItem(item.key, { categoryName: e.target.value || null })}
                    className="rounded border border-ink/10 bg-white px-2 py-1"
                  >
                    <option value="">—</option>
                    {props.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    value={item.quantity ?? ""}
                    onChange={(e) =>
                      updateItem(item.key, { quantity: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="w-16 rounded border border-ink/10 bg-white px-2 py-1 font-mono"
                  />
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    value={item.unitPrice ?? ""}
                    onChange={(e) =>
                      updateItem(item.key, { unitPrice: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="w-20 rounded border border-ink/10 bg-white px-2 py-1 font-mono"
                  />
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    value={item.lineTotal}
                    onChange={(e) => updateItem(item.key, { lineTotal: Number(e.target.value) })}
                    className="w-20 rounded border border-ink/10 bg-white px-2 py-1 font-mono"
                  />
                </td>
                <td className="p-1 whitespace-nowrap font-mono text-xs text-ink/60">
                  {item.normalizedQuantity != null ? `${item.normalizedQuantity} ${item.normalizedUnit ?? ""}` : "—"}
                </td>
                <td className="p-1">
                  <button
                    type="button"
                    onClick={() => props.setItems(props.items.filter((it) => it.key !== item.key))}
                    className="text-ink/40 hover:text-maroon"
                    aria-label="Remove line"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => props.setItems([...props.items, blankItem()])}
        className="mt-2 rounded-md border border-dashed border-ink/20 px-3 py-1.5 text-sm text-ink/60 hover:border-ink/40"
      >
        + Add line item
      </button>

      <div className="mt-6 flex flex-col items-end gap-1 border-t-2 border-ink/20 pt-4 font-mono text-sm">
        <TotalRow label="Subtotal (excl. GST)" value={props.subtotal} onChange={props.setSubtotal} />
        <TotalRow label="GST" value={props.gstAmount} onChange={props.setGstAmount} />
        <TotalRow label="Total (incl. GST)" value={props.total} onChange={props.setTotal} bold />
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-md bg-gold px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gold-deep disabled:opacity-60"
        >
          {submitting ? "Saving…" : props.editExpenseId ? "Save changes" : "Submit expense"}
        </button>
        <button
          type="button"
          onClick={props.onDiscard}
          className="rounded-md border border-ink/15 px-5 py-2.5 text-ink/70 hover:border-ink/30"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink/70">{label}</span>
      {children}
    </label>
  );
}

function TotalRow({
  label,
  value,
  onChange,
  bold,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-ink/60">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-28 rounded border border-ink/15 bg-white px-2 py-1 text-right ${bold ? "text-lg font-semibold" : ""}`}
      />
    </div>
  );
}
