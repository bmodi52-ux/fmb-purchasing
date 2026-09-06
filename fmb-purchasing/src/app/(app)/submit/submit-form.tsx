"use client";

import { SubmitButton } from "@/components/submit-button";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extractReceiptAction,
  lookupAbnAction,
  uploadReceiptFileAction,
  reportOversizeReceiptAction,
  findPossibleDuplicates,
  createExpense,
  updateExpense,
  type ExtractState,
  type UploadFileState,
  type AttachmentInput,
  type LineItemInput,
  type ItemLookupSuggestion,
  type ExpenseForEdit,
  type DuplicateWarning,
} from "./actions";
import type { ExtractedReceipt, StoredLineKind } from "@/lib/receipt-extraction";
import type { PayeeChoice } from "@/lib/payees";
import { VendorLookupFields } from "./vendor-lookup-fields";
import { ItemLookupCells } from "./item-lookup-cells";
import { PayeePicker } from "./payee-picker";
import { ReconciliationStrip, CHARGE_KIND_LABELS } from "./reconciliation-strip";
import { shrinkImageForUpload, MAX_UPLOAD_BYTES, formatBytes } from "@/lib/image-resize";
import { normalizeReceiptDate } from "@/lib/format";
import { round2, sumLines, residualFor } from "@/lib/expense-money";

const initialExtractState: ExtractState = { data: null, attachment: null, error: null };
const initialUploadState: UploadFileState = { attachment: null, error: null };

type ReviewItem = LineItemInput & {
  key: string;
  itemNumber: string;
  /** Added by the app to account for the receipt total, not read from the receipt. */
  autoAdded?: boolean;
};

/**
 * An unfinished submission, kept in this browser.
 *
 * All of this state was React-local, so a phone that backgrounded the tab
 * mid-review lost everything typed. That is worst on exactly the submissions
 * that take the most typing: nearly a fifth of them arrive with no receipt at
 * all and every line is entered by hand.
 *
 * localStorage rather than the server: a draft is per-person and per-device,
 * it has no meaning to anyone else, and it should not become a row that
 * someone later has to clean up.
 */
const DRAFT_KEY = "fmb-expense-draft";

type Draft = {
  vendorName: string;
  abn: string;
  invoiceNumber: string;
  receiptDate: string;
  total: number;
  printedGst: number | null;
  submitterComment: string;
  attachments: AttachmentInput[];
  items: ReviewItem[];
  payee: PayeeChoice | null;
  savedAt: number;
};

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    // A fortnight-old draft is far more likely to be forgotten litter than
    // something someone still wants.
    if (Date.now() - draft.savedAt > 14 * 24 * 60 * 60 * 1000) return null;
    return draft;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // A browser refusing storage is not a reason to fail a submission.
  }
}

function toReviewItems(items: ExtractedReceipt["lineItems"]): ReviewItem[] {
  return items.map((item, i) => ({
    key: `${i}-${Date.now()}`,
    itemNumber: "",
    description: item.description,
    // Frozen at extraction time: editing the row never touches this, so a
    // corrected line still knows what the receipt was originally read as.
    originalDescription: item.description,
    kind: item.kind,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal ?? (item.quantity && item.unitPrice ? round2(item.quantity * item.unitPrice) : 0),
    categoryName: item.category,
    gstApplicable: item.gstApplicable,
    normalizedQuantity: item.normalizedQuantity,
    normalizedUnit: item.normalizedUnit,
  }));
}

function blankItem(kind: StoredLineKind = "goods", lineTotal = 0): ReviewItem {
  return {
    key: String(Math.random()),
    itemNumber: "",
    description: kind === "goods" ? "" : CHARGE_KIND_LABELS[kind as Exclude<StoredLineKind, "goods">],
    // Typed by hand, so there is no earlier reading to compare against.
    originalDescription: null,
    kind,
    quantity: null,
    unitPrice: null,
    lineTotal,
    categoryName: null,
    // A charge is usually taxable even when the goods are not — a card
    // surcharge on GST-free groceries still carries GST.
    gstApplicable: kind !== "goods" && kind !== "rounding",
    normalizedQuantity: null,
    normalizedUnit: null,
  };
}

/**
 * Adds a line for whatever the extracted lines do not account for.
 *
 * A 56c gap on a $100 grocery receipt is the card surcharge, and nobody
 * should have to tell the app that. A $1,097 gap on a $3,021 invoice is not
 * a surcharge — it is line items nobody read — so that one is booked as
 * unallocated and stays visible for a person. residualFor draws the line.
 */
function withBookedResidual(items: ReviewItem[], receiptTotal: number): ReviewItem[] {
  const residual = residualFor(
    items.map((i) => ({ kind: i.kind, lineTotal: i.lineTotal, gstApplicable: i.gstApplicable })),
    receiptTotal
  );
  if (!residual) return items;

  const line = blankItem(residual.kind, residual.amount);
  return [
    ...items,
    {
      ...line,
      autoAdded: true,
      description:
        residual.reason === "unitemised"
          ? "Not itemised on the receipt"
          : line.description,
      // An unallocated remainder has no way of knowing whether GST applies,
      // and guessing yes would invent a credit.
      gstApplicable: residual.reason === "charge" ? line.gstApplicable : false,
    },
  ];
}

export function SubmitForm({
  categories,
  vendorNames,
  myName,
  editExpense,
}: {
  categories: string[];
  vendorNames: string[];
  myName: string;
  editExpense?: ExpenseForEdit | null;
}) {
  const router = useRouter();
  const [extractState, extractAction, extracting] = useActionState(
    extractReceiptAction,
    initialExtractState
  );
  const [mode, setMode] = useState<"start" | "review">(editExpense ? "review" : "start");
  const [preparing, setPreparing] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentInput[]>(editExpense?.attachments ?? []);

  const [vendorName, setVendorName] = useState(editExpense?.vendorName ?? "");
  const [vendorNumber, setVendorNumber] = useState("");
  const [abn, setAbn] = useState(editExpense?.abn ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(editExpense?.invoiceNumber ?? "");
  const [receiptDate, setReceiptDate] = useState(editExpense?.receiptDate ?? "");
  const [total, setTotal] = useState(editExpense?.total ?? 0);
  const [printedGst, setPrintedGst] = useState<number | null>(null);
  const [submitterComment, setSubmitterComment] = useState(editExpense?.submitterComment ?? "");
  const [payee, setPayee] = useState<PayeeChoice | null>(
    editExpense?.payee ?? (editExpense ? null : { kind: "me" })
  );
  const [extractedPayeeName, setExtractedPayeeName] = useState<string | null>(null);
  const [extractionNote, setExtractionNote] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>(() =>
    editExpense
      ? editExpense.lineItems.map((it, i) => ({ ...it, key: `edit-${i}`, itemNumber: "" }))
      : []
  );
  const [restoredDraft, setRestoredDraft] = useState(false);

  // Offer an unfinished submission back, once, on a fresh form only. Editing an
  // existing expense is a different job and must never be seeded from a draft.
  useEffect(() => {
    if (editExpense || mode === "review") return;
    const draft = readDraft();
    if (!draft || draft.items.length === 0) return;
    // localStorage is an external system, and it cannot be read during render
    // because this component also renders on the server. Seeding from it is
    // exactly what an effect is for, even though the rule cannot tell.
    /* eslint-disable react-hooks/set-state-in-effect */
    setVendorName(draft.vendorName);
    setAbn(draft.abn);
    setInvoiceNumber(draft.invoiceNumber);
    setReceiptDate(draft.receiptDate);
    setTotal(draft.total);
    setPrintedGst(draft.printedGst);
    setSubmitterComment(draft.submitterComment);
    setAttachments(draft.attachments);
    setItems(draft.items);
    setPayee(draft.payee);
    setRestoredDraft(true);
    setMode("review");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populates local form state from the AI-extraction server action's
  // result — an external system, not a derivable value — so an effect is
  // the right tool.
  useEffect(() => {
    if (extractState.data) {
      const d = extractState.data;
      /* eslint-disable react-hooks/set-state-in-effect */
      setVendorName(d.vendor ?? "");
      setAbn(d.abn ?? "");
      setInvoiceNumber(d.invoiceNumber ?? "");
      setReceiptDate(normalizeReceiptDate(d.date));
      const reviewItems = toReviewItems(d.lineItems);
      // The receipt total is what the receipt says, not what the lines sum to.
      // When extraction could not read one, the lines are the best available
      // starting point — and the strip then shows it as balanced, which is
      // honest: there is nothing yet to disagree with.
      const receiptTotal = round2(d.total ?? sumLines(reviewItems));
      // Extraction reads most charges itself — surcharge, delivery and discount
      // lines all come back with their own kind. When it misses one, the
      // arithmetic still says what it was, so the app books it rather than
      // handing the submitter a subtraction to do. Only a gap too large to be a
      // charge is left visibly unresolved.
      const withResidual = withBookedResidual(reviewItems, receiptTotal);
      setItems(withResidual.length ? withResidual : [blankItem()]);
      setTotal(receiptTotal);
      setPrintedGst(d.gstAmount);
      setExtractedPayeeName(d.payee?.name ?? null);
      setExtractionNote(d.note);
      if (d.payee?.name) {
        setPayee({
          kind: "new",
          displayName: d.payee.name,
          bankAccountName: d.payee.bankAccountName,
          bsb: d.payee.bsb,
          accountNumber: d.payee.accountNumber,
        });
      }
      if (extractState.attachment) setAttachments([extractState.attachment]);
      setMode("review");
      /* eslint-enable react-hooks/set-state-in-effect */
    } else if (extractState.attachment && extractState.error) {
      // extraction failed but the file uploaded fine — fall back to a blank manual form
      setAttachments([extractState.attachment]);
      setItems([blankItem()]);
      setMode("review");
    }
  }, [extractState]);

  // Keep the draft current. Debounced so typing a description is one write at
  // the end rather than one per keystroke.
  useEffect(() => {
    if (editExpense || mode !== "review" || items.length === 0) return;
    const timer = setTimeout(() => {
      try {
        const draft: Draft = {
          vendorName, abn, invoiceNumber, receiptDate, total, printedGst,
          submitterComment, attachments, items, payee, savedAt: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Private browsing, or storage full. The form still works.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [editExpense, mode, vendorName, abn, invoiceNumber, receiptDate, total,
      printedGst, submitterComment, attachments, items, payee]);

  async function handleReceiptChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const form = input.form;
    const chosen = input.files?.[0];
    if (!chosen || !form) return;

    setSizeError(null);
    setPreparing(true);
    try {
      const prepared = await shrinkImageForUpload(chosen);
      if (prepared.size > MAX_UPLOAD_BYTES) {
        setSizeError(
          `That file is ${formatBytes(prepared.size)}, which is too large to upload. ` +
            `Please use a photo instead of a scan, or split the PDF.`
        );
        // Not awaited, and its failure is swallowed: telling someone their file
        // is too big must not wait on, or be replaced by, a reporting error.
        void reportOversizeReceiptAction({
          fileName: prepared.name,
          fileType: prepared.type,
          sizeBytes: prepared.size,
        }).catch(() => {});
        input.value = "";
        return;
      }

      if (prepared !== chosen) {
        const transfer = new DataTransfer();
        transfer.items.add(prepared);
        input.files = transfer.files;
      }
      form.requestSubmit();
    } finally {
      setPreparing(false);
    }
  }

  function startManual() {
    setVendorName("");
    setVendorNumber("");
    setAbn("");
    setInvoiceNumber("");
    setReceiptDate("");
    setTotal(0);
    setPrintedGst(null);
    setItems([blankItem()]);
    setAttachments([]);
    setPayee({ kind: "me" });
    setMode("review");
  }

  function discard() {
    clearDraft();
    router.push("/my-submissions");
  }

  if (mode === "start") {
    const busy = preparing || extracting;
    return (
      <div className="flex flex-col gap-4">
        <form action={extractAction} className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-ink/20 bg-white/50 p-8 text-center">
          {/* The control is disabled while a request is in flight. It was not,
              which on a slow connection meant an impatient second tap ran the
              whole upload and the model call again. */}
          <label className={busy ? "cursor-progress opacity-60" : "cursor-pointer"}>
            <input
              type="file"
              name="file"
              accept="image/*,application/pdf"
              required
              disabled={busy}
              className="hidden"
              onChange={handleReceiptChosen}
            />
            <span className="section-title text-ink">Upload or scan a receipt</span>
            <p className="mt-1 text-sm text-ink/60">JPG, PNG, WebP, or PDF. Tap to choose a file.</p>
          </label>
          {preparing && <p className="font-mono text-sm text-ink/60">Preparing photo…</p>}
          {extracting && <p className="font-mono text-sm text-ink/60">Reading receipt…</p>}
          {sizeError && !extracting && <p className="text-sm text-red-700">{sizeError}</p>}
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
      myName={myName}
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
      total={total}
      setTotal={setTotal}
      printedGst={printedGst}
      submitterComment={submitterComment}
      setSubmitterComment={setSubmitterComment}
      attachments={attachments}
      setAttachments={setAttachments}
      payee={payee}
      setPayee={setPayee}
      extractedPayeeName={extractedPayeeName}
      extractionNote={extractionNote}
      restoredDraft={restoredDraft}
      onDiscard={discard}
      onSubmitted={clearDraft}
      editExpenseId={editExpense?.id ?? null}
    />
  );
}

function ReviewForm(props: {
  categories: string[];
  vendorNames: string[];
  myName: string;
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
  total: number;
  setTotal: (v: number) => void;
  printedGst: number | null;
  submitterComment: string;
  setSubmitterComment: (v: string) => void;
  attachments: AttachmentInput[];
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentInput[]>>;
  payee: PayeeChoice | null;
  setPayee: (p: PayeeChoice | null) => void;
  extractedPayeeName: string | null;
  extractionNote: string | null;
  restoredDraft: boolean;
  onDiscard: () => void;
  onSubmitted: () => void;
  editExpenseId: string | null;
}) {
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();
  const [lookingUpAbn, startAbnLookup] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploadState, uploadAction, uploading] = useActionState(uploadReceiptFileAction, initialUploadState);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  useEffect(() => {
    if (uploadState.attachment) {
      const added = uploadState.attachment;
      props.setAttachments((prev) =>
        // Content-addressed, so re-attaching the same file is a no-op rather
        // than a second identical row.
        prev.some((a) => a.storagePath === added.storagePath) ? prev : [...prev, added]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState]);

  // Look for an earlier submission of the same thing, once the fields that
  // could identify one have settled.
  useEffect(() => {
    const shaList = props.attachments.map((a) => a.sha256).filter((s): s is string => !!s);
    const nothingToMatchOn = shaList.length === 0 && !props.invoiceNumber.trim();

    // Both branches settle inside the timer rather than in the effect body, so
    // clearing a stale warning is a callback like any other.
    const timer = setTimeout(() => {
      if (nothingToMatchOn) {
        setDuplicates([]);
        return;
      }
      findPossibleDuplicates({
        sha256List: shaList,
        vendorName: props.vendorName,
        invoiceNumber: props.invoiceNumber,
        excludeExpenseId: props.editExpenseId,
      })
        .then((found) => {
          setDuplicates(found);
          if (found.length === 0) setDuplicatesAcknowledged(false);
        })
        .catch(() => setDuplicates([]));
    }, 600);
    return () => clearTimeout(timer);
  }, [props.attachments, props.invoiceNumber, props.vendorName, props.editExpenseId]);

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
    updateItem(key, { categoryName: s.categoryName ?? undefined });
  }

  function addCharge(kind: StoredLineKind, amount: number) {
    props.setItems((prev) => [...prev, blankItem(kind, amount)]);
  }

  function handleAbnLookup() {
    setError(null);
    startAbnLookup(async () => {
      const result = await lookupAbnAction(props.abn);
      if ("error" in result) setError(result.error);
      else props.setVendorName(result.name);
    });
  }

  const moneyLines = props.items.map((it) => ({
    kind: it.kind,
    lineTotal: it.lineTotal,
    gstApplicable: it.gstApplicable,
  }));

  function handleSubmit() {
    setError(null);
    if (!props.vendorName.trim()) {
      setError("Vendor is required.");
      return;
    }
    if (duplicates.length > 0 && !duplicatesAcknowledged) {
      setError("This looks like something already submitted — confirm below, or change the details.");
      return;
    }
    startSubmit(async () => {
      const payload = {
        vendorName: props.vendorName,
        abn: props.abn || null,
        invoiceNumber: props.invoiceNumber || null,
        receiptDate: props.receiptDate || null,
        attachments: props.attachments,
        total: props.total,
        submitterComment: props.submitterComment.trim() || null,
        payee: props.payee,
        lineItems: props.items
          .filter((it) => it.description.trim())
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ key: _key, itemNumber: _itemNumber, ...rest }) => rest),
      };
      const result = props.editExpenseId
        ? await updateExpense(props.editExpenseId, payload)
        : await createExpense(payload);
      if ("error" in result) setError(result.error);
      else {
        props.onSubmitted();
        router.push("/my-submissions");
      }
    });
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 p-6">
      <h2 className="section-title text-ink">Review details</h2>
      <p className="mb-5 text-sm text-ink/60">Check and correct anything before submitting.</p>

      {props.restoredDraft && (
        <p className="mb-4 rounded-md bg-palm/10 px-3 py-2 text-sm text-ink/75">
          Picked up where you left off. Nothing has been submitted yet.
        </p>
      )}

      {props.extractionNote && (
        <p className="mb-4 rounded-md bg-gold/10 px-3 py-2 text-sm text-ink/70">{props.extractionNote}</p>
      )}

      {duplicates.length > 0 && (
        <div className="mb-5 rounded-md border border-maroon/30 bg-maroon/5 px-4 py-3">
          <p className="text-sm font-medium text-maroon">
            {duplicates.length === 1 ? "This may already have been submitted" : "These may already have been submitted"}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/75">
            {duplicates.map((d) => (
              <li key={d.expenseId}>
                <span className="font-mono text-xs text-ink/60">{d.expenseNumber ?? "—"}</span>{" "}
                {d.vendorName} ·{" "}
                {d.total.toLocaleString("en-AU", { style: "currency", currency: "AUD" })} ·{" "}
                {d.status} · submitted by {d.submittedByName}
                <span className="ml-1 text-xs text-ink/50">
                  ({d.reason === "same-file" ? "identical file" : "same invoice number"})
                </span>
              </li>
            ))}
          </ul>
          <label className="mt-2.5 flex items-center gap-2 text-sm text-ink/75">
            <input
              type="checkbox"
              checked={duplicatesAcknowledged}
              onChange={(e) => setDuplicatesAcknowledged(e.target.checked)}
            />
            This is a separate expense — submit it anyway
          </label>
        </div>
      )}

      <Attachments
        attachments={props.attachments}
        setAttachments={props.setAttachments}
        uploadAction={uploadAction}
        uploading={uploading}
        uploadError={uploadState.error}
        attachError={attachError}
        setAttachError={setAttachError}
      />

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

      <div className="mb-6">
        <PayeePicker
          value={props.payee}
          onChange={props.setPayee}
          myName={props.myName}
          extractedName={props.extractedPayeeName}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/50">
              <th scope="col" className="p-1">Item #</th>
              <th scope="col" className="p-1">Description</th>
              <th scope="col" className="p-1">Category</th>
              <th scope="col" className="p-1">Qty</th>
              <th scope="col" className="p-1">Unit price</th>
              <th scope="col" className="p-1">Line total</th>
              <th scope="col" className="p-1" title="Whether GST applies to this line">GST</th>
              <th scope="col" className="p-1">Per-unit</th>
              <th scope="col" className="p-1" />
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr
                key={item.key}
                // A line the app added to make the receipt add up is tinted, so
                // the submitter is confirming something rather than hunting for
                // what changed.
                className={`border-t border-ink/5 ${item.autoAdded ? "bg-gold/10" : ""}`}
              >
                {item.kind === "goods" ? (
                  <ItemLookupCells
                    itemNumber={item.itemNumber}
                    setItemNumber={(v) => updateItem(item.key, { itemNumber: v })}
                    description={item.description}
                    setDescription={(v) => updateItem(item.key, { description: v })}
                    onSelect={(s) => selectItemSuggestion(item.key, s)}
                  />
                ) : (
                  <>
                    {/* A charge is not a product, so it gets no item number and
                        no Pricelist lookup — matching one would file "CREDIT
                        SURCHARGE" as a pending item under the vendor. */}
                    <td className="p-1 text-xs text-ink/35">—</td>
                    <td className="p-1">
                      <input
                        value={item.description}
                        onChange={(e) => updateItem(item.key, { description: e.target.value })}
                        className="w-full min-w-[10rem] rounded border border-ink/10 bg-white px-2 py-1"
                      />
                    </td>
                  </>
                )}
                <td className="p-1">
                  {item.kind === "goods" ? (
                    <select
                      value={item.categoryName ?? ""}
                      onChange={(e) => updateItem(item.key, { categoryName: e.target.value || null })}
                      className="rounded border border-ink/10 bg-white px-2 py-1"
                      aria-label="Category"
                    >
                      <option value="">—</option>
                      {props.categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={item.kind}
                      onChange={(e) => updateItem(item.key, { kind: e.target.value as StoredLineKind })}
                      className="rounded border border-ink/10 bg-white px-2 py-1"
                      aria-label="Charge type"
                    >
                      {Object.entries(CHARGE_KIND_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    value={item.quantity ?? ""}
                    disabled={item.kind !== "goods"}
                    onChange={(e) =>
                      updateItem(item.key, { quantity: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="w-16 rounded border border-ink/10 bg-white px-2 py-1 font-mono disabled:bg-ink/5"
                    aria-label="Quantity"
                  />
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    value={item.unitPrice ?? ""}
                    disabled={item.kind !== "goods"}
                    onChange={(e) =>
                      updateItem(item.key, { unitPrice: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="w-20 rounded border border-ink/10 bg-white px-2 py-1 font-mono disabled:bg-ink/5"
                    aria-label="Unit price"
                  />
                </td>
                <td className="p-1">
                  <input
                    type="number"
                    step="0.01"
                    value={item.lineTotal}
                    onChange={(e) => updateItem(item.key, { lineTotal: Number(e.target.value) })}
                    className="w-24 rounded border border-ink/10 bg-white px-2 py-1 font-mono"
                    aria-label="Line total"
                  />
                </td>
                <td className="p-1 text-center">
                  <input
                    type="checkbox"
                    checked={item.gstApplicable}
                    onChange={(e) => updateItem(item.key, { gstApplicable: e.target.checked })}
                    aria-label={`GST applies to ${item.description || "this line"}`}
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
                    aria-label={`Remove ${item.description || "line"}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => props.setItems([...props.items, blankItem()])}
          className="rounded-md border border-dashed border-ink/20 px-3 py-1.5 text-sm text-ink/60 hover:border-ink/40"
        >
          + Add line item
        </button>
        <button
          type="button"
          onClick={() => addCharge("surcharge", 0)}
          className="rounded-md border border-dashed border-ink/20 px-3 py-1.5 text-sm text-ink/60 hover:border-ink/40"
        >
          + Add a charge or discount
        </button>
      </div>

      <ReconciliationStrip
        lines={moneyLines}
        receiptTotal={props.total}
        onReceiptTotalChange={props.setTotal}
        printedGst={props.printedGst}
        onAddCharge={addCharge}
        autoAddedCount={props.items.filter((i) => i.autoAdded).length}
      />

      {/* Below the numbers, because it is usually written about them — a price
          that looks wrong, a missing receipt, a part-delivered order. Kept out
          of the line item descriptions on purpose: those are what receipt
          matching learns wordings from (0023), so a note buried in one would
          be remembered as a name for the product. */}
      <label className="mt-6 flex flex-col gap-1 text-sm">
        <span className="text-ink/70">
          Comments <span className="text-ink/40">(optional)</span>
        </span>
        <textarea
          value={props.submitterComment}
          onChange={(e) => props.setSubmitterComment(e.target.value)}
          rows={3}
          placeholder="Anything the approver should know — a missing receipt, an unusual price, what the spend was for."
          className="input resize-y"
        />
      </label>

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

/**
 * Files supporting the expense. More than one, because a real submission is
 * routinely a receipt plus a delivery docket, or a two-page invoice
 * photographed twice because it would not fit in one frame.
 */
function Attachments({
  attachments,
  setAttachments,
  uploadAction,
  uploading,
  uploadError,
  attachError,
  setAttachError,
}: {
  attachments: AttachmentInput[];
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentInput[]>>;
  uploadAction: (formData: FormData) => void;
  uploading: boolean;
  uploadError: string | null;
  attachError: string | null;
  setAttachError: (v: string | null) => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-md border border-dashed border-ink/20 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ink/70">Attachments:</span>
        {attachments.length === 0 && <span className="text-ink/45">none</span>}
      </div>

      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map((a) => (
            <li key={a.storagePath} className="flex items-center gap-2">
              <span className="truncate text-ink">{a.fileName}</span>
              {a.sizeBytes != null && (
                <span className="shrink-0 text-xs text-ink/45">{formatBytes(a.sizeBytes)}</span>
              )}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.storagePath !== a.storagePath))}
                className="shrink-0 text-xs text-maroon/70 hover:underline"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={uploadAction} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept="image/*,application/pdf"
          disabled={uploading}
          className="min-w-0 max-w-full text-xs"
          // same downscale as the main upload — this path hits the identical
          // Server Action body limit
          onChange={async (e) => {
            const input = e.currentTarget;
            const chosen = input.files?.[0];
            if (!chosen) return;
            setAttachError(null);
            const prepared = await shrinkImageForUpload(chosen);
            if (prepared.size > MAX_UPLOAD_BYTES) {
              setAttachError(`Too large (${formatBytes(prepared.size)}).`);
              void reportOversizeReceiptAction({
                fileName: prepared.name,
                fileType: prepared.type,
                sizeBytes: prepared.size,
              }).catch(() => {});
              input.value = "";
              return;
            }
            if (prepared !== chosen) {
              const transfer = new DataTransfer();
              transfer.items.add(prepared);
              input.files = transfer.files;
            }
          }}
        />
        <SubmitButton
          disabled={uploading}
          className="rounded-md border border-ink/15 px-3 py-1 text-xs hover:border-ink/30 disabled:opacity-60"
        >
          {uploading ? "Attaching…" : "Attach"}
        </SubmitButton>
      </form>

      {attachError && <span className="text-xs text-red-700">{attachError}</span>}
      {uploadError && <span className="text-xs text-red-700">{uploadError}</span>}
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
