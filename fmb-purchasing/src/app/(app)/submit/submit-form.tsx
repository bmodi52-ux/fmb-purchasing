"use client";

import { SubmitButton } from "@/components/submit-button";
import { useReportPending } from "@/components/pending";
import { Fragment, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extractReceiptAction,
  lookupAbnAction,
  uploadReceiptFileAction,
  reportOversizeReceiptAction,
  findPossibleDuplicates,
  resolveVendorAction,
  matchReceiptLinesAction,
  createExpense,
  updateExpense,
  type ExtractState,
  type UploadFileState,
  type AttachmentInput,
  type LineItemInput,
  type ItemLookupSuggestion,
  type ExpenseForEdit,
  type DuplicateWarning,
  type ResolvedVendor,
  type LineMatchResult,
} from "./actions";
import type { ExtractedReceipt } from "@/lib/receipt-extraction";
import type { StoredLineKind } from "@/lib/line-kinds";
import type { PayeeChoice } from "@/lib/payees";
import { VendorLookupFields } from "./vendor-lookup-fields";
import { ItemLookupCells } from "./item-lookup-cells";
import { LineMatchRow } from "./line-match";
import { PayeePicker } from "./payee-picker";
import {
  ReconciliationStrip,
  CHARGE_KIND_LABELS,
  LINE_KIND_LABELS,
  type ChargeKind,
} from "./reconciliation-strip";
import { shrinkImageForUpload, MAX_UPLOAD_BYTES, formatBytes } from "@/lib/image-resize";
import { normalizeReceiptDate } from "@/lib/format";
import { round2, sumLines, residualFor } from "@/lib/expense-money";
import { categoriesForLineGroup, lineGroupFor } from "@/lib/categories";

const initialExtractState: ExtractState = { data: null, attachment: null, error: null };
const initialUploadState: UploadFileState = { attachment: null, error: null };

type ReviewItem = LineItemInput & {
  key: string;
  itemNumber: string;
  /** Added by the app to account for the receipt total, not read from the receipt. */
  autoAdded?: boolean;
  /**
   * The Pricelist item and pack this line is filed against, as the form shows
   * it. Undefined until it has been looked for; null where there is nothing to
   * look for yet — a blank line, or one being typed.
   */
  match?: LineMatchResult | null;
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

/**
 * What a receipt goes through between being chosen and appearing in the form.
 *
 * Three real waits, not an animation: the photo is shrunk in the browser, the
 * file is uploaded, and then the model reads it. They used to be one caption —
 * "Reading receipt…" — for up to half a minute, so there was no telling a slow
 * connection from a slow read, or either from a page that had died.
 */
type UploadStage = "preparing" | "uploading" | "reading" | null;

const UPLOAD_STEPS: { id: Exclude<UploadStage, null>; label: string; done: string }[] = [
  { id: "preparing", label: "Preparing the photo…", done: "Photo prepared" },
  { id: "uploading", label: "Uploading the receipt…", done: "Receipt uploaded" },
  { id: "reading", label: "Reading the receipt…", done: "Receipt read" },
];

/** Where a step stands relative to the one actually running. */
function stepState(
  step: Exclude<UploadStage, null>,
  current: UploadStage
): "done" | "current" | "waiting" {
  if (current === null) return "waiting";
  const at = UPLOAD_STEPS.findIndex((s) => s.id === current);
  const mine = UPLOAD_STEPS.findIndex((s) => s.id === step);
  return mine < at ? "done" : mine === at ? "current" : "waiting";
}

/** A category as the line-item picker needs it: what to show, and when. */
export type PickableCategory = { name: string; appliesTo: string[] | null };

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
  const isCharge = kind !== "goods" && kind !== "service";
  return {
    key: String(Math.random()),
    itemNumber: "",
    // A charge names itself — "Card or service surcharge" is the whole of what
    // that line is. Goods and services have to be described by the person,
    // because "Service" tells a reviewer nothing about what was bought.
    description: isCharge ? CHARGE_KIND_LABELS[kind as ChargeKind] : "",
    // Typed by hand, so there is no earlier reading to compare against.
    originalDescription: null,
    kind,
    quantity: null,
    unitPrice: null,
    lineTotal,
    categoryName: null,
    // A charge is usually taxable even when the goods are not — a card
    // surcharge on GST-free groceries still carries GST. So is a service:
    // cleaning and maintenance are not basic food, whatever the rest of the
    // receipt is. Only rounding never carries any.
    gstApplicable: kind !== "goods" && kind !== "rounding",
    normalizedQuantity: null,
    normalizedUnit: null,
    match: null,
  };
}

/**
 * A line with what matching found applied to it: the item and pack become the
 * line's pins, which is what the submission is then filed against.
 *
 * An offer pinned by an earlier edit gives way to its pack, so the submission
 * files against this expense's own vendor's offer on that pack — not whichever
 * vendor's offer the line pointed at before.
 */
function withMatch(item: ReviewItem, result: LineMatchResult | null): ReviewItem {
  if (!result) return { ...item, match: null };
  return {
    ...item,
    match: result,
    itemId: result.itemId,
    packSizeId: result.packSizeId,
    pricelistItemId: null,
    itemNumber: result.itemNumber ?? item.itemNumber,
    categoryName: result.categoryName ?? item.categoryName,
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
  /** Leaf categories, sorted, each tagged with the line kinds it suits. */
  categories: PickableCategory[];
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
  const [stage, setStage] = useState<UploadStage>(null);
  // The two client-side stages, kept under one name because everything that
  // asks is really asking "is a receipt on its way in?".
  const preparing = stage === "preparing" || stage === "uploading";
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentInput[]>(editExpense?.attachments ?? []);

  // Reading a receipt is by far the longest wait here, and it was the one
  // thing in the app that never reached the shared hairline — only navigations,
  // submit buttons and table actions did. Now the same top-of-viewport cue
  // appears for it as for everything else.
  useReportPending(preparing || extracting);

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
  const [resolvedVendor, setResolvedVendor] = useState<ResolvedVendor | null>(null);
  const [resolvingVendor, setResolvingVendor] = useState(false);
  /**
   * The vendor name exactly as extraction read it, so the automatic ABR lookup
   * below can tell an untouched field from one the submitter has since typed
   * into. Null once they edit it, and null from the start for a manual entry.
   */
  const nameFromExtraction = useRef<string | null>(null);
  /** The ABN the ABR has already been asked about, so it is asked once. */
  const abrCheckedAbn = useRef<string | null>(null);

  // Work out which vendor on file this receipt belongs to, whether the name
  // arrived from extraction, a restored draft, or typing. Read-only: nothing is
  // created until the expense is submitted.
  //
  // Debounced and sequence-guarded, because it runs on every keystroke in the
  // vendor field and answers cross the Pacific — without the guard, a slow
  // reply for "Foodwo" can land after the fast one for "Foodworks" and put the
  // wrong vendor on screen.
  const vendorResolveSeq = useRef(0);
  useEffect(() => {
    const name = vendorName.trim();
    const cleanAbn = abn.replace(/\D/g, "");
    // A server action is an external system; querying one and storing what it
    // says is what effects exist for, even though the rule sees only setState.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!name && !cleanAbn) {
      setResolvedVendor(null);
      setResolvingVendor(false);
      return;
    }
    const seq = ++vendorResolveSeq.current;
    setResolvingVendor(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const handle = setTimeout(async () => {
      try {
        const found = await resolveVendorAction(name, cleanAbn || null);
        if (seq !== vendorResolveSeq.current) return;
        setResolvedVendor(found);
      } catch {
        // A failed lookup must not block the submission; the write path does
        // its own matching regardless of what this managed to show.
        if (seq === vendorResolveSeq.current) setResolvedVendor(null);
      } finally {
        if (seq === vendorResolveSeq.current) setResolvingVendor(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [vendorName, abn]);

  /**
   * Ask the ABR who owns this ABN, without waiting to be told to.
   *
   * The registered name was a button press away and nothing else, so a receipt
   * whose ABN extraction had read perfectly still showed "Not in Vendors yet"
   * until somebody thought to press it — and the name the submission was filed
   * under stayed whatever the shopfront happened to print.
   *
   * Only when the vendor is not already on file: a match found locally is the
   * answer, and overwriting its name with the ABR's would fight the name
   * somebody chose. Once per ABN, because the answer cannot change between
   * keystrokes, and never while editing an existing expense — that name is
   * already settled.
   *
   * Silent on failure. This is a convenience running in the background; the
   * "Look up vendor" button is still there to try again and to say why.
   */
  useEffect(() => {
    if (editExpense) return;
    const digits = abn.replace(/\D/g, "");
    if (digits.length !== 11) return;
    if (abrCheckedAbn.current === digits) return;
    // Let the local check settle first — it decides whether to ask at all.
    if (resolvingVendor) return;
    if (resolvedVendor) {
      abrCheckedAbn.current = digits;
      return;
    }

    abrCheckedAbn.current = digits;
    let cancelled = false;
    void (async () => {
      try {
        const result = await lookupAbnAction(digits);
        if (cancelled || "error" in result) return;
        setVendorName((current) =>
          !current.trim() || current === nameFromExtraction.current ? result.name : current
        );
      } catch {
        // Never blocks the form; the write path matches on its own regardless.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [abn, editExpense, resolvedVendor, resolvingVendor]);

  // Fill the Vendor # the submitter did not have to know, once matching has
  // found it. Only when blank, so it never fights a number they typed.
  useEffect(() => {
    if (resolvedVendor?.vendorNumber && !vendorNumber) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVendorNumber(resolvedVendor.vendorNumber);
    }
  }, [resolvedVendor, vendorNumber]);

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
    /* eslint-disable react-hooks/set-state-in-effect */
    // Whatever came back, no step is still running. Cleared here rather than
    // where extraction was started, because that call returns the moment the
    // action is queued — see readReceiptFile.
    setStage(null);
    if (extractState.data) {
      const d = extractState.data;
      setVendorName(d.vendor ?? "");
      // Remembered, not just set: the ABR lookup below only replaces a name
      // still exactly as extraction left it.
      nameFromExtraction.current = d.vendor ?? "";
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

  /**
   * Read a receipt, however it arrived.
   *
   * Takes a File rather than a change event so one path serves the file
   * picker, a pasted screenshot and a dropped file. Plenty of receipts here
   * are never photographed — they are screenshots or email attachments — and
   * "save it somewhere, then find it again in a picker" was a detour around
   * the clipboard the person was already holding it on.
   */
  async function readReceiptFile(chosen: File, onRejected?: () => void) {
    setSizeError(null);
    setStage("preparing");
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
        onRejected?.();
        return;
      }

      // Sent as an explicit payload rather than by asking the form to read its
      // own fields: the input is disabled while this runs, and a disabled
      // control is left out of the FormData a native submit builds, so the
      // action saw no file at all and rejected every upload.
      //
      // Uploaded first and read second, as two calls, so the two waits can be
      // told apart on screen: the upload is as slow as the connection, and the
      // model call takes about the same ten to twenty seconds regardless. As
      // one call they were one silent minute. If the upload half fails, the
      // read is still attempted with the file itself — the action takes either
      // — so the split can never cost somebody a receipt.
      setStage("uploading");
      const payload = new FormData();
      payload.append("file", prepared);
      const uploaded = await uploadReceiptFileAction({ attachment: null, error: null }, payload);

      const readPayload = new FormData();
      if (uploaded.attachment) {
        readPayload.append("attachment", JSON.stringify(uploaded.attachment));
      } else {
        readPayload.append("file", prepared);
      }
      setStage("reading");
      extractAction(readPayload);
    } finally {
      // "reading" is left standing: extraction is now in flight under
      // useActionState, and clearing the stage here would blank the caption
      // for the longest wait of the three.
      setStage((current) => (current === "reading" ? current : null));
    }
  }

  async function handleReceiptChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const chosen = input.files?.[0];
    if (!chosen) return;
    await readReceiptFile(chosen, () => {
      input.value = "";
    });
  }

  /**
   * Paste a receipt straight onto the page.
   *
   * Bound to the document rather than to a focusable element, because there is
   * nothing on this screen anyone would think to click first — the natural
   * gesture is to arrive on Submit and press Ctrl+V. Only while the upload area
   * is what is showing, so that pasting into a line item's description later
   * cannot be mistaken for handing over a new receipt.
   */
  useEffect(() => {
    if (mode !== "start" || preparing || extracting) return;

    function onPaste(event: ClipboardEvent) {
      // A screenshot arrives as an image item; a file copied out of a file
      // manager or a mail client arrives as a file. Anything else — text,
      // HTML — is somebody pasting into a field, and none of our business.
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((i) => i.kind === "file")
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void readReceiptFile(file);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, preparing, extracting]);

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
        <div
          // The dashed border always promised a drop target; now it is one.
          // dragover has to be cancelled or the browser navigates away to the
          // dropped file instead, taking the half-filled form with it.
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDraggingOver(true);
          }}
          onDragLeave={(e) => {
            // Fires for every child the pointer crosses; only the crossing that
            // actually leaves the zone should clear the highlight.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDraggingOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingOver(false);
            if (busy) return;
            const file = e.dataTransfer.files?.[0];
            if (file) void readReceiptFile(file);
          }}
          className={`flex flex-col gap-3 rounded-lg border-2 border-dashed bg-white/50 p-8 text-center transition-colors ${
            draggingOver ? "border-gold-deep bg-gold/10" : "border-ink/20"
          }`}
        >
          {/* The control is disabled while a request is in flight. It was not,
              which on a slow connection meant an impatient second tap ran the
              whole upload and the model call again. The chosen file is passed
              to the action by hand, so being disabled cannot hide it. */}
          <label className={busy ? "cursor-progress opacity-60" : "cursor-pointer"}>
            <input
              type="file"
              // .eml is listed by extension as well as by type: Windows often
              // reports no MIME type for it at all, and an accept list it
              // cannot match hides the file in the picker.
              accept="image/*,application/pdf,message/rfc822,.eml"
              disabled={busy}
              className="hidden"
              onChange={handleReceiptChosen}
            />
            <span className="section-title text-ink">Upload or scan a receipt</span>
            <p className="mt-1 text-sm text-ink/60">
              Tap to choose a file, drag one here, or paste a screenshot.
            </p>
            <p className="mt-1 text-xs text-ink/45">
              JPG, PNG, WebP, PDF, or a saved email (.eml).
            </p>
          </label>
          {/* Reading a receipt is the longest wait in the app — ten to twenty
              seconds against the model — and it used to show one line of static
              text, which after a few seconds is indistinguishable from a page
              that has died. An indeterminate bar cannot claim progress it does
              not know, but it can keep saying "still working", which is the
              part that was missing.

              The three steps are each genuinely observed rather than a timed
              animation: the browser shrinks the photo, uploads it, and then
              asks for it to be read, and the caption is whichever of those has
              actually been reached. */}
          {busy && (
            <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
              <ol className="flex flex-col gap-1 text-left">
                {UPLOAD_STEPS.map((step) => {
                  const state = stepState(step.id, stage ?? (extracting ? "reading" : null));
                  return (
                    <li
                      key={step.id}
                      className={`flex items-center gap-2 font-mono text-sm ${
                        state === "done"
                          ? "text-ink/40"
                          : state === "current"
                            ? "text-ink/70"
                            : "text-ink/30"
                      }`}
                    >
                      <span aria-hidden="true" className="w-4 text-center">
                        {state === "done" ? "✓" : state === "current" ? "…" : "·"}
                      </span>
                      {state === "done" ? step.done : step.label}
                    </li>
                  );
                })}
              </ol>
              <span className="inline-progress" aria-hidden="true" />
              {extracting && (
                <p className="text-xs text-ink/45">
                  Usually about ten seconds. You can leave this page open.
                </p>
              )}
            </div>
          )}
          {sizeError && !extracting && <p className="text-sm text-red-700">{sizeError}</p>}
          {extractState.error && !extracting && (
            <p className="text-sm text-red-700">{extractState.error}</p>
          )}
        </div>
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
      resolvedVendor={resolvedVendor}
      resolvingVendor={resolvingVendor}
      onDiscard={discard}
      onSubmitted={clearDraft}
      editExpenseId={editExpense?.id ?? null}
    />
  );
}

function ReviewForm(props: {
  /** Leaf categories, sorted, each tagged with the line kinds it suits. */
  categories: PickableCategory[];
  vendorNames: string[];
  myName: string;
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorNumber: string;
  setVendorNumber: (v: string) => void;
  resolvedVendor: ResolvedVendor | null;
  resolvingVendor: boolean;
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

  // Look every goods line up on the Pricelist as soon as it arrives — from a
  // receipt, a restored draft or an expense being edited — so the form can say
  // what each line will be filed against before anything is saved. Lines are
  // marked in flight so a re-render cannot ask twice, and a line edited while
  // its answer is on the way keeps the edit.
  const matchingKeys = useRef(new Set<string>());
  useEffect(() => {
    const pending = props.items.filter(
      (it) =>
        it.kind === "goods" &&
        it.match === undefined &&
        it.description.trim() !== "" &&
        !matchingKeys.current.has(it.key)
    );
    if (pending.length === 0) return;

    const keys = new Set(pending.map((it) => it.key));
    for (const key of keys) matchingKeys.current.add(key);

    matchReceiptLinesAction({
      vendorName: props.vendorName,
      abn: props.abn || null,
      lines: pending.map((it) => ({
        key: it.key,
        description: it.description,
        categoryName: it.categoryName,
        itemId: it.itemId ?? null,
        pricelistItemId: it.pricelistItemId ?? null,
      })),
    })
      .then((results) =>
        props.setItems((prev) =>
          prev.map((it) =>
            keys.has(it.key) && it.match === undefined ? withMatch(it, results[it.key] ?? null) : it
          )
        )
      )
      .catch(() =>
        // Matching failing must never stop a submission; the line is filed the
        // way it always was.
        props.setItems((prev) =>
          prev.map((it) => (keys.has(it.key) && it.match === undefined ? { ...it, match: null } : it))
        )
      )
      .finally(() => {
        for (const key of keys) matchingKeys.current.delete(key);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.items]);

  /** Look an unlinked line up again once someone has finished typing it. */
  function rematchIfUnlinked(key: string) {
    props.setItems((prev) =>
      prev.map((it) =>
        it.key === key &&
        it.kind === "goods" &&
        it.match === null &&
        !it.itemId &&
        !it.packSizeId &&
        it.description.trim()
          ? { ...it, match: undefined }
          : it
      )
    );
  }

  function confirmMatch(key: string) {
    props.setItems((prev) =>
      prev.map((it) => (it.key === key && it.match ? { ...it, match: { ...it.match, confidence: "sure" } } : it))
    );
  }

  /** "Not this": the line stops pointing at the item, which is kept as an option. */
  function rejectMatch(key: string) {
    props.setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key || !it.match) return it;
        const m = it.match;
        const passedOver = m.itemId && m.itemName ? [{ itemId: m.itemId, itemName: m.itemName, itemNumber: m.itemNumber }] : [];
        return {
          ...it,
          itemId: null,
          packSizeId: null,
          pricelistItemId: null,
          itemNumber: "",
          match: {
            ...m,
            confidence: "none",
            itemId: null,
            itemNumber: null,
            itemName: null,
            categoryName: null,
            packSizeId: null,
            packs: [],
            alternatives: [...passedOver, ...m.alternatives.filter((a) => a.itemId !== m.itemId)],
          },
        };
      })
    );
  }

  function choosePack(key: string, packSizeId: string | null) {
    props.setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? { ...it, packSizeId, pricelistItemId: null, match: it.match ? { ...it.match, packSizeId } : it.match }
          : it
      )
    );
  }

  /** An item offered as an alternative: looked up again with that item fixed. */
  function chooseItem(key: string, itemId: string) {
    props.setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, itemId, packSizeId: null, pricelistItemId: null, match: undefined } : it
      )
    );
  }

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
        // A pinned offer says "this line is that offer". Retyping the
        // description or the item number is how someone says it isn't any
        // more, so the pin goes with it — otherwise a line reading "Rice 10kg"
        // would still be filed against the 5 kg pack that was picked first.
        // A patch that names the pin itself is the pin being set, not edited.
        if (
          patch.pricelistItemId === undefined &&
          patch.itemId === undefined &&
          patch.packSizeId === undefined &&
          (patch.description !== undefined || patch.itemNumber !== undefined)
        ) {
          next.pricelistItemId = null;
          next.itemId = null;
          next.packSizeId = null;
          next.match = null;
        }
        return next;
      })
    );
  }

  function selectItemSuggestion(key: string, s: ItemLookupSuggestion) {
    // The suggestion is one pack of one item, whether or not any vendor has an
    // offer on it yet — so choosing it settles which pack the line is, and the
    // submission adds this vendor's offer to that pack if it needs one.
    updateItem(key, {
      categoryName: s.categoryName ?? undefined,
      itemId: s.itemId,
      packSizeId: s.packSizeId,
      pricelistItemId: null,
      match: {
        confidence: "sure",
        itemId: s.itemId,
        itemNumber: s.itemNumber,
        itemName: s.description,
        categoryName: s.categoryName,
        packSizeId: s.packSizeId,
        packs: s.packs,
        alternatives: [],
      },
    });
  }

  function addCharge(kind: StoredLineKind, amount: number) {
    props.setItems((prev) => [...prev, blankItem(kind, amount)]);
  }

  /**
   * Change what a line is, and clear what no longer applies to it.
   *
   * Only goods carry a per-unit cost, so a line that stops being goods has to
   * shed its quantity, unit price and normalised units — otherwise a
   * reclassified line keeps a "$450 per ea" that the inputs no longer show but
   * the database would still be told about, and which the costing views are
   * only kept away from by their kind filter.
   *
   * The item number goes too: it points at a Pricelist offer that a service or
   * a charge will never be matched against.
   */
  function changeKind(key: string, kind: StoredLineKind) {
    props.setItems((prev) =>
      prev.map((it) =>
        it.key !== key
          ? it
          : {
              ...it,
              kind,
              ...(kind === "goods"
                ? { match: it.description.trim() ? undefined : null }
                : {
                    itemNumber: "",
                    pricelistItemId: null,
                    itemId: null,
                    packSizeId: null,
                    match: null,
                    quantity: null,
                    unitPrice: null,
                    normalizedQuantity: null,
                    normalizedUnit: null,
                  }),
            }
      )
    );
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
    const goods = props.items.filter((it) => it.kind === "goods" && it.description.trim());
    if (goods.some((it) => it.match === undefined)) {
      setError("Still checking the lines against the Pricelist — try again in a moment.");
      return;
    }
    // Which pack decides what the quantity means — sixteen boxes or sixteen
    // kilos — so it is never guessed on the way in.
    const packless = goods.find((it) => it.itemId && !it.packSizeId && (it.match?.packs.length ?? 0) > 1);
    if (packless) {
      setError(`Choose which pack of ${packless.match?.itemName ?? "the item"} "${packless.description}" is.`);
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
          .map(({ key: _key, itemNumber: _itemNumber, match: _match, autoAdded: _autoAdded, ...rest }) => rest),
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
          resolved={props.resolvedVendor}
          resolving={props.resolvingVendor}
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
          vendorName={props.vendorName}
          vendorHasPaymentDetails={props.resolvedVendor?.hasPaymentDetails ?? false}
          extractedName={props.extractedPayeeName}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/50">
              {/* What the line *is* used to be implicit — inferable only from
                  whether the Category cell had turned into a charge picker.
                  Now that a service is its own kind, and the difference decides
                  whether the line reaches the Pricelist at all, it is worth a
                  column of its own that can also be corrected. */}
              <th scope="col" className="p-1">Type</th>
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
              <Fragment key={item.key}>
              <tr
                // A line the app added to make the receipt add up is tinted, so
                // the submitter is confirming something rather than hunting for
                // what changed.
                className={`border-t border-ink/5 ${item.autoAdded ? "bg-gold/10" : ""}`}
              >
                <td className="p-1">
                  <select
                    value={item.kind}
                    onChange={(e) => changeKind(item.key, e.target.value as StoredLineKind)}
                    className="rounded border border-ink/10 bg-white px-2 py-1"
                    aria-label="Line type"
                  >
                    {Object.entries(LINE_KIND_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                {item.kind === "goods" ? (
                  <ItemLookupCells
                    itemNumber={item.itemNumber}
                    setItemNumber={(v) => updateItem(item.key, { itemNumber: v })}
                    description={item.description}
                    setDescription={(v) => updateItem(item.key, { description: v })}
                    onSelect={(s) => selectItemSuggestion(item.key, s)}
                    onDescriptionBlur={() => rematchIfUnlinked(item.key)}
                  />
                ) : (
                  <>
                    {/* Neither a charge nor a service is a product, so neither
                        gets an item number or a Pricelist lookup. Matching a
                        charge would file "CREDIT SURCHARGE" as a pending item
                        under the vendor; matching a service would file
                        "Monthly kitchen deep clean — August", and then
                        September's separately (migration 0035). */}
                    <td className="p-1 text-xs text-ink/35">—</td>
                    <td className="p-1">
                      <input
                        value={item.description}
                        onChange={(e) => updateItem(item.key, { description: e.target.value })}
                        placeholder={item.kind === "service" ? "What was done" : undefined}
                        className="w-full min-w-[10rem] rounded border border-ink/10 bg-white px-2 py-1"
                      />
                    </td>
                  </>
                )}
                <td className="p-1">
                  {/* Every kind carries a category now, services included —
                      that is how a repair reaches Maintenance & Repairs in the
                      reports without ever touching the catalogue. Charges used
                      to lose this cell to the kind picker, so a delivery fee
                      could be categorised by extraction but never corrected. */}
                  <CategorySelect
                    categories={props.categories}
                    kind={item.kind}
                    value={item.categoryName}
                    onChange={(name) => updateItem(item.key, { categoryName: name })}
                  />
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
              {item.kind === "goods" && (
                <LineMatchRow
                  description={item.description}
                  match={item.match}
                  onConfirm={() => confirmMatch(item.key)}
                  onReject={() => rejectMatch(item.key)}
                  onChoosePack={(packSizeId) => choosePack(item.key, packSizeId)}
                  onChooseItem={(itemId) => chooseItem(item.key, itemId)}
                />
              )}
              </Fragment>
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
          onClick={() => addCharge("service", 0)}
          className="rounded-md border border-dashed border-ink/20 px-3 py-1.5 text-sm text-ink/60 hover:border-ink/40"
        >
          + Add a service
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
          accept="image/*,application/pdf,message/rfc822,.eml"
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

/**
 * The category picker on a line item.
 *
 * Every line carries a category, and this used to offer all nineteen of them
 * whatever the line was — so a bag of rice was chosen past Professional &
 * Contractor Services, and a plumber past Dairy & Eggs. The line already knows
 * what it is, so the ones that suit it come first and the rest stay under
 * "Other categories": tagging is an ordering, not a restriction, because a
 * category tagged wrongly must never make a receipt impossible to file.
 */
function CategorySelect({
  categories,
  kind,
  value,
  onChange,
}: {
  categories: PickableCategory[];
  kind: StoredLineKind;
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const { relevant, others } = categoriesForLineGroup(categories, lineGroupFor(kind));

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded border border-ink/10 bg-white px-2 py-1"
      aria-label="Category"
    >
      <option value="">—</option>
      {relevant.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
      {others.length > 0 && (
        <optgroup label="Other categories">
          {others.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
