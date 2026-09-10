"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission, userCan } from "@/lib/permissions";
import { extractReceipt, type ExtractedReceipt, type StoredLineKind } from "@/lib/receipt-extraction";
import { lookupAbn, type AbnLookupResult } from "@/lib/abn-lookup";
import {
  matchOrCreateVendor,
  matchOrCreateOffer,
  chosenItem,
  chosenOffer,
  chosenPack,
  preferredVendor,
} from "@/lib/expense-matching";
import {
  choosePack,
  matchLine,
  normalizeWording,
  type CatalogueItem,
  type CatalogueUnit,
  type KnownWording,
  type MatchConfidence,
} from "@/lib/line-matching";
import { fiscalYearForReceipt } from "@/lib/fiscal-year";
import { notifyExpenseSubmitted } from "@/lib/expense-notifications";
import { leafCategories } from "@/lib/categories";
import { packTitle } from "@/lib/pack-description";
import { itemIdsByRetiredNumber, itemMatchFilter } from "@/lib/item-search";
import { ilikeContains, orFilter } from "@/lib/pgrst-filter";
import { reportError } from "@/lib/errors";
import { lineGst, lineSubtotal, reconcile, round2, sumLineGst } from "@/lib/expense-money";
import {
  resolvePayee,
  searchPayees,
  getPayee,
  vendorPaymentDetails,
  type PayeeChoice,
  type PayeeSuggestion,
} from "@/lib/payees";
import {
  ACCEPTED_TYPES,
  RECEIPTS_BUCKET,
  expenseIdsWithFile,
  receiptContentType,
  receiptStoragePath,
  sha256Hex,
  storeReceiptFile,
  type StoredFile,
} from "@/lib/receipt-storage";
import { checkExtractionThrottle } from "@/lib/extraction-throttle";

export type ExtractState = {
  data: ExtractedReceipt | null;
  /** The stored file, whether or not extraction managed to read it. */
  attachment: StoredFile | null;
  error: string | null;
};

/**
 * Extraction results, keyed by the SHA-256 of the file they were read from.
 *
 * Two taps on the same receipt used to mean two uploads and two model calls.
 * The upload half is fixed by content-addressing; this fixes the billing half,
 * and makes the second attempt instant — which removes the impatience that
 * caused it. Process-local and unbounded is fine: entries are small, a serverless
 * instance is short-lived, and a miss costs only what the call would have cost
 * anyway.
 */
const extractionCache = new Map<string, ExtractedReceipt>();

async function readUpload(
  formData: FormData
): Promise<{ file: File; bytes: Uint8Array } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a receipt photo, PDF or saved email first." };
  }
  // Windows reports no type at all for .eml when nothing is registered to open
  // it, so the extension is consulted before the file is turned away.
  const contentType = receiptContentType(file.name, file.type);
  if (!ACCEPTED_TYPES.has(contentType)) {
    return { error: "Only JPG, PNG, WebP, PDF, or .eml files are supported." };
  }
  return {
    file: contentType === file.type ? file : new File([file], file.name, { type: contentType }),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * A file the browser has already uploaded, quoted back for reading.
 *
 * The upload and the model call are two waits with nothing in common: one is
 * as slow as the connection, the other takes ten to twenty seconds whatever
 * the connection. Run as one action they were one indistinguishable "Reading
 * receipt…", so this lets the browser do them in turn and say which is
 * happening — see readReceiptFile in submit-form.tsx.
 *
 * Only the hash and content type are believed. The path is recomputed from
 * them and the bytes are re-hashed after download, so quoting somebody else's
 * storage path fetches nothing, and quoting a hash you do not have the file
 * for is not something you can do.
 */
function storedUpload(
  formData: FormData
): { attachment: StoredFile } | { error: string } | null {
  const raw = formData.get("attachment");
  if (typeof raw !== "string" || !raw) return null;

  let claimed: StoredFile;
  try {
    claimed = JSON.parse(raw) as StoredFile;
  } catch {
    return { error: "That upload could not be read back. Please choose the file again." };
  }
  if (
    typeof claimed?.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(claimed.sha256) ||
    !ACCEPTED_TYPES.has(claimed.contentType)
  ) {
    return { error: "That upload could not be read back. Please choose the file again." };
  }

  return {
    attachment: {
      storagePath: receiptStoragePath(claimed.sha256, claimed.contentType),
      fileName: typeof claimed.fileName === "string" ? claimed.fileName : "receipt",
      contentType: claimed.contentType,
      sizeBytes: Number(claimed.sizeBytes) || 0,
      sha256: claimed.sha256,
      alreadyStored: true,
    },
  };
}

/** The bytes behind an upload the browser has already made. */
async function downloadStoredReceipt(
  admin: ReturnType<typeof createAdminClient>,
  attachment: StoredFile
): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .download(attachment.storagePath);
  if (error || !data) return null;

  const bytes = new Uint8Array(await data.arrayBuffer());
  // The path came from the quoted hash, so this is what proves the quote was
  // honest rather than a guess at somebody else's file.
  return sha256Hex(bytes) === attachment.sha256 ? bytes : null;
}

export async function extractReceiptAction(
  _prev: ExtractState,
  formData: FormData
): Promise<ExtractState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const admin = createAdminClient();

  const stored = storedUpload(formData);
  if (stored && "error" in stored) {
    return { data: null, attachment: null, error: stored.error };
  }

  let attachment: StoredFile;
  let bytes: Uint8Array | null = null;
  let fileType: string;
  let fileSize: number;

  if (stored) {
    attachment = stored.attachment;
    fileType = attachment.contentType;
    fileSize = attachment.sizeBytes;
  } else {
    const read = await readUpload(formData);
    if ("error" in read) return { data: null, attachment: null, error: read.error };
    bytes = read.bytes;
    fileType = read.file.type;
    fileSize = read.file.size;

    try {
      attachment = await storeReceiptFile(admin, {
        bytes: read.bytes,
        name: read.file.name,
        type: read.file.type,
      });
    } catch (err) {
      await reportError({
        source: "receipt-upload",
        error: err,
        detail: `${read.file.type}, ${read.file.size} bytes`,
        userId: user.id,
      });
      return {
        data: null,
        attachment: null,
        error: `Could not save the receipt file: ${(err as Error).message}`,
      };
    }
  }

  // Served before the throttle is consulted: a repeat of a file already read
  // costs nothing, so it should not consume anyone's allowance either. Also
  // before the download below, so a repeat never fetches the bytes at all.
  const cached = extractionCache.get(attachment.sha256);
  if (cached) return { data: cached, attachment, error: null };

  const verdict = await checkExtractionThrottle(user.id);
  if (!verdict.allowed) {
    return {
      data: null,
      attachment,
      error:
        `That's a lot of receipts in one hour. The reader will accept more in about ` +
        `${verdict.retryAfterMinutes} minute${verdict.retryAfterMinutes === 1 ? "" : "s"} — ` +
        `you can still fill this one in by hand in the meantime.`,
    };
  }

  if (!bytes) {
    bytes = await downloadStoredReceipt(admin, attachment);
    if (!bytes) {
      return {
        data: null,
        attachment: null,
        error: "That upload could not be read back. Please choose the file again.",
      };
    }
  }

  const { data: categories } = await admin
    .from("categories")
    .select("id, name, parent_category_id")
    .order("sort_order");
  const categoryNames = leafCategories(categories ?? []).map((c) => c.name);

  try {
    const base64 = Buffer.from(bytes).toString("base64");
    const extracted = await extractReceipt(base64, fileType, categoryNames);
    extractionCache.set(attachment.sha256, extracted);
    return { data: extracted, attachment, error: null };
  } catch (err) {
    // The submitter is told to carry on manually, so without this the
    // failure is invisible — extraction could break for one vendor's PDF
    // layout and the only signal would be people quietly typing more.
    await reportError({
      source: "receipt-extraction",
      error: err,
      detail: `${fileType}, ${fileSize} bytes`,
      userId: user.id,
    });
    return {
      data: null,
      attachment,
      error: `Could not read that receipt automatically (${(err as Error).message}). You can still fill in the details manually.`,
    };
  }
}

export async function lookupAbnAction(abn: string): Promise<AbnLookupResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");
  return lookupAbn(abn);
}

export type UploadFileState = { attachment: StoredFile | null; error: string | null };

/** Attach a file during manual entry, without triggering AI extraction. */
export async function uploadReceiptFileAction(
  _prev: UploadFileState,
  formData: FormData
): Promise<UploadFileState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const read = await readUpload(formData);
  if ("error" in read) return { attachment: null, error: read.error };

  try {
    const attachment = await storeReceiptFile(createAdminClient(), {
      bytes: read.bytes,
      name: read.file.name,
      type: read.file.type,
    });
    return { attachment, error: null };
  } catch (err) {
    return { attachment: null, error: `Could not save the file: ${(err as Error).message}` };
  }
}

/**
 * A receipt rejected in the browser for being too large, before any upload was
 * attempted.
 *
 * This is the one failure a submitter can hit that leaves no trace anywhere:
 * reportError only runs server-side, and the size check happens before
 * anything is sent, so nothing reaches a catch block. The person is simply
 * told to split their PDF, and nobody else ever finds out.
 *
 * That matters because it decides a real question. Photos are downscaled
 * client-side and land well under the limit; PDFs cannot be, so a large
 * scanned invoice is a dead end. Whether that dead end is ever actually
 * reached is what determines if uploading direct to storage with a signed URL
 * — a moderate refactor of this flow — is worth building. Without this, the
 * answer only arrives if someone thinks to complain.
 *
 * Telemetry, so it fails silently: a submitter already looking at an error
 * must never get a second one because the reporting itself was refused.
 */
export async function reportOversizeReceiptAction(input: {
  fileName: string;
  fileType: string;
  sizeBytes: number;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  if (!(await userCan(user, "submit_expense", "submit"))) return;

  const megabytes = (input.sizeBytes / (1024 * 1024)).toFixed(1);
  const kind = input.fileType === "application/pdf" ? "PDF" : (input.fileType || "file");

  // The size sits in the message on purpose: record_error_event fingerprints
  // with digits stripped, so every occurrence collapses onto one row while the
  // row still shows the most recent size.
  await reportError({
    source: "receipt-too-large",
    error: `${kind} of ${megabytes} MB exceeded the upload limit`,
    detail:
      `${input.fileName} (${input.fileType}, ${input.sizeBytes} bytes) was rejected in the browser ` +
      `before upload. The cap is the Server Action request body limit, currently 3.5MB client-side. ` +
      `Images are downscaled automatically; a PDF cannot be, so if this is a PDF the submitter had no ` +
      `way to proceed. Repeated occurrences are the signal to upload direct to storage via a signed URL.`,
    userId: user.id,
  });
}

export type VendorLookupSuggestion = { id: string; vendorNumber: string | null; name: string };

/** Vendor #/name typeahead for manual entry (§ user feedback). */
export async function searchVendorsAction(query: string): Promise<VendorLookupSuggestion[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("vendors")
    .select("id, vendor_number, name")
    .or(orFilter(ilikeContains("vendor_number", trimmed), ilikeContains("name", trimmed)))
    .eq("status", "approved")
    .limit(8);

  return (data ?? []).map((v) => ({ id: v.id, vendorNumber: v.vendor_number, name: v.name }));
}

export type ResolvedVendor = {
  id: string;
  vendorNumber: string | null;
  name: string;
  /** 'pending' while nobody has reviewed it yet. */
  status: string;
  /**
   * Whether this vendor can be paid directly without retyping bank details —
   * and deliberately not the details themselves.
   *
   * Migration 0027 put bank details behind `payments:mark_paid`, and this
   * action answers to anyone who can submit an expense. A submitter needs to
   * know the account is on file so they do not type it again; they do not need
   * to be told the number to know that.
   */
  hasPaymentDetails: boolean;
};

/**
 * Which vendor the receipt just read actually belongs to.
 *
 * The typeahead only ever fired on a keystroke, so a name filled in by
 * extraction was never looked up: Vendor # stayed blank, nothing said the shop
 * was already on file, and the form looked exactly as it would for a vendor
 * nobody had ever entered. Submitters reasonably concluded a duplicate was
 * about to be created — and while the write path would in fact have matched,
 * being unable to tell is its own defect, and it hid the real duplicate bug
 * that migration 0034 fixes.
 *
 * Runs the same lookup as matchOrCreateVendor, in the same preference order,
 * so what the form shows is what the submission will be filed against. Never
 * writes: an unrecognised vendor stays unrecognised until the expense is
 * actually submitted.
 */
export async function resolveVendorAction(
  name: string,
  abn: string | null
): Promise<ResolvedVendor | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const cleanAbn = abn?.replace(/\D/g, "") || null;
  const trimmed = name.trim();
  if (!cleanAbn && !trimmed) return null;

  const admin = createAdminClient();
  const select = "id, vendor_number, name, status, created_at";

  let match = cleanAbn
    ? preferredVendor(
        (await admin.from("vendors").select(select).eq("abn", cleanAbn).limit(20)).data ?? []
      )
    : null;

  if (!match && trimmed) {
    match = preferredVendor(
      (
        await admin
          .from("vendors")
          .select(select)
          .ilike("name", trimmed.toLowerCase().replace(/\s+/g, " "))
          .limit(20)
      ).data ?? []
    );
  }

  if (!match) return null;

  return {
    id: match.id,
    vendorNumber: match.vendor_number,
    name: match.name,
    status: match.status,
    hasPaymentDetails: (await vendorPaymentDetails(admin, match.id)) !== null,
  };
}

export type LinePackOption = { id: string; title: string };

export type ItemLookupSuggestion = {
  /** Unique per suggestion: the pack, or the item when it has no packs yet. */
  key: string;
  itemId: string;
  packSizeId: string | null;
  itemNumber: string | null;
  /** The item's name, which becomes the line's description when chosen. */
  description: string;
  packSizeLabel: string | null;
  categoryName: string | null;
  /** Every pack of the item, so the line can be switched between them. */
  packs: LinePackOption[];
};

type PackRow = {
  id: string;
  item_id: string;
  label: string | null;
  inner_quantity: number;
  inner_unit_id: string;
  pack_count: number;
  sold_loose: boolean;
  packaging: string | null;
};

type UnitRow = { id: string; code: string; label: string; base_unit_code: string; to_base_factor: number };

const PACK_COLUMNS = "id, item_id, label, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging";

/** An item's packs as the form offers them, named the way the Pricelist names them. */
function packOptions(packs: PackRow[], unitById: Map<string, UnitRow>): LinePackOption[] {
  return packs
    .map((p) => ({
      id: p.id,
      title: packTitle(p.label, {
        innerQuantity: p.inner_quantity,
        unitLabel: unitById.get(p.inner_unit_id)?.label,
        packCount: p.pack_count,
        soldLoose: p.sold_loose,
        packaging: p.packaging,
      }),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Item #/name typeahead for goods lines — one suggestion per pack size.
 *
 * It used to list only approved vendor offers, eight at most, so a pack nobody
 * had priced yet could not be picked at all: Tomato's second pack simply never
 * appeared, and the only way to file against it was to let the submission
 * create another. Every pack of every item still in use is offered now, and
 * choosing one adds this vendor's offer to it on submission when it needs one.
 *
 * Also finds an item by what receipts have called it, so typing the invoice's
 * own words — "box tomato" — finds Tomato.
 */
export async function searchPricelistItemsAction(query: string): Promise<ItemLookupSuggestion[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const admin = createAdminClient();

  const [retiredMatchIds, { data: wordingRows }] = await Promise.all([
    itemIdsByRetiredNumber(admin, trimmed),
    admin.from("vendor_item_descriptions").select("item_id").ilike("description", `%${trimmed}%`).limit(20),
  ]);
  const alsoMatchingIds = [
    ...new Set([...retiredMatchIds, ...(wordingRows ?? []).map((r) => r.item_id as string)]),
  ];

  const { data: matchedItems } = await admin
    .from("items")
    .select("id, item_number, name, category_id")
    .or(itemMatchFilter(trimmed, alsoMatchingIds))
    .neq("status", "rejected")
    .order("name")
    .limit(20);
  const items = matchedItems ?? [];
  if (items.length === 0) return [];

  const [{ data: packRows }, { data: categories }, { data: units }] = await Promise.all([
    admin
      .from("item_pack_sizes")
      .select(PACK_COLUMNS)
      .in(
        "item_id",
        items.map((i) => i.id)
      ),
    admin.from("categories").select("id, name"),
    admin.from("units").select("id, code, label, base_unit_code, to_base_factor"),
  ]);
  const unitById = new Map(((units ?? []) as UnitRow[]).map((u) => [u.id, u]));
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const packsByItem = new Map<string, PackRow[]>();
  for (const p of (packRows ?? []) as PackRow[]) {
    packsByItem.set(p.item_id, [...(packsByItem.get(p.item_id) ?? []), p]);
  }

  const suggestions: ItemLookupSuggestion[] = [];
  for (const item of items) {
    const packs = packOptions(packsByItem.get(item.id) ?? [], unitById);
    const common = {
      itemId: item.id as string,
      itemNumber: item.item_number as string | null,
      description: item.name as string,
      categoryName: item.category_id ? (categoryNameById.get(item.category_id) ?? null) : null,
      packs,
    };
    if (packs.length === 0) {
      suggestions.push({ ...common, key: common.itemId, packSizeId: null, packSizeLabel: "No pack sizes yet" });
    }
    for (const p of packs) {
      suggestions.push({ ...common, key: p.id, packSizeId: p.id, packSizeLabel: p.title });
    }
  }
  return suggestions.slice(0, 12);
}

export type LineMatchResult = {
  confidence: MatchConfidence;
  itemId: string | null;
  itemNumber: string | null;
  itemName: string | null;
  categoryName: string | null;
  /** Null when the item has several packs and the line doesn't say which. */
  packSizeId: string | null;
  packs: LinePackOption[];
  /** Other items worth offering, best first. */
  alternatives: { itemId: string; itemName: string; itemNumber: string | null }[];
};

export type LineToResolve = {
  key: string;
  description: string;
  categoryName: string | null;
  /** An item the submitter chose, to find the pack for. */
  itemId: string | null;
  /** The offer an expense being edited already files this line against. */
  pricelistItemId: string | null;
};

const PAGE_SIZE = 1000;

/** Every row a query returns, a page at a time past Supabase's row cap. */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

type WordingRow = { item_id: string; vendor_id: string | null; description: string };

/**
 * Which Pricelist item and pack each receipt line is, before anything is saved.
 *
 * Matching used to run only at submission and only on the exact wording, so a
 * line reading "Box Tomato" never found the Tomato somebody had set up, and
 * became a second one without a word said. This runs as soon as a receipt is
 * read — and on a restored draft, and on an expense being edited — so the form
 * shows every line's match and asks where it isn't sure. See line-matching.ts
 * for how a line is read. Never writes.
 */
export async function matchReceiptLinesAction(input: {
  vendorName: string;
  abn: string | null;
  lines: LineToResolve[];
}): Promise<Record<string, LineMatchResult>> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");
  if (input.lines.length === 0) return {};

  const admin = createAdminClient();
  const vendorId = (await resolveVendorAction(input.vendorName, input.abn))?.id ?? null;

  const wordings = [...new Set(input.lines.map((l) => normalizeWording(l.description)).filter(Boolean))];
  const pinnedOfferIds = input.lines.map((l) => l.pricelistItemId).filter((id): id is string => !!id);
  const wordingColumns = "item_id, vendor_id, description";

  const [itemRows, packRows, unitsResult, categoriesResult, exactWordings, vendorlessWordings, ownWordings, vendorOffers, pinnedOffersResult] =
    await Promise.all([
      allRows<{ id: string; name: string; item_number: string | null; category_id: string | null }>((from, to) =>
        admin.from("items").select("id, name, item_number, category_id").neq("status", "rejected").order("id").range(from, to)
      ),
      allRows<PackRow>((from, to) => admin.from("item_pack_sizes").select(PACK_COLUMNS).order("id").range(from, to)),
      admin.from("units").select("id, code, label, base_unit_code, to_base_factor"),
      admin.from("categories").select("id, name"),
      // The exact wordings on this receipt, whoever used them…
      wordings.length
        ? allRows<WordingRow>((from, to) =>
            admin
              .from("vendor_item_descriptions")
              .select(wordingColumns)
              .in("description_normalized", wordings)
              .order("id")
              .range(from, to)
          )
        : Promise.resolve([] as WordingRow[]),
      // …names items have been renamed away from…
      allRows<WordingRow>((from, to) =>
        admin.from("vendor_item_descriptions").select(wordingColumns).is("vendor_id", null).order("id").range(from, to)
      ),
      // …and everything this vendor has called anything.
      vendorId
        ? allRows<WordingRow>((from, to) =>
            admin
              .from("vendor_item_descriptions")
              .select(wordingColumns)
              .eq("vendor_id", vendorId)
              .order("id")
              .range(from, to)
          )
        : Promise.resolve([] as WordingRow[]),
      vendorId
        ? allRows<{ pack_size_id: string }>((from, to) =>
            admin
              .from("pricelist_items")
              .select("pack_size_id")
              .eq("vendor_id", vendorId)
              .neq("status", "rejected")
              .order("id")
              .range(from, to)
          )
        : Promise.resolve([] as { pack_size_id: string }[]),
      pinnedOfferIds.length
        ? admin.from("pricelist_items").select("id, pack_size_id").in("id", pinnedOfferIds)
        : Promise.resolve({ data: [] }),
    ]);

  const units = (unitsResult.data ?? []) as UnitRow[];
  const unitById = new Map(units.map((u) => [u.id, u]));
  const categoryNameById = new Map((categoriesResult.data ?? []).map((c) => [c.id as string, c.name as string]));
  const packById = new Map(packRows.map((p) => [p.id, p]));
  const packsByItem = new Map<string, PackRow[]>();
  for (const p of packRows) packsByItem.set(p.item_id, [...(packsByItem.get(p.item_id) ?? []), p]);

  const catalogue: CatalogueItem[] = itemRows.map((i) => ({
    id: i.id,
    name: i.name,
    itemNumber: i.item_number,
    categoryName: i.category_id ? (categoryNameById.get(i.category_id) ?? null) : null,
    packs: (packsByItem.get(i.id) ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      innerQuantity: Number(p.inner_quantity),
      unitCode: unitById.get(p.inner_unit_id)?.code ?? null,
      packCount: Number(p.pack_count),
      soldLoose: p.sold_loose,
      packaging: p.packaging,
    })),
  }));
  const itemById = new Map(catalogue.map((i) => [i.id, i]));
  const catalogueUnits: CatalogueUnit[] = units.map((u) => ({
    code: u.code,
    baseUnitCode: u.base_unit_code,
    toBaseFactor: Number(u.to_base_factor),
  }));
  const known: KnownWording[] = [...exactWordings, ...vendorlessWordings, ...ownWordings].map((w) => ({
    itemId: w.item_id,
    vendorId: w.vendor_id,
    description: w.description,
  }));
  const vendorPackIds = new Set(vendorOffers.map((o) => o.pack_size_id));
  const packOfOffer = new Map(
    ((pinnedOffersResult.data ?? []) as { id: string; pack_size_id: string }[]).map((o) => [o.id, o.pack_size_id])
  );

  const alternativesFor = (ids: string[]) =>
    ids.flatMap((id) => {
      const alt = itemById.get(id);
      return alt ? [{ itemId: alt.id, itemName: alt.name, itemNumber: alt.itemNumber }] : [];
    });

  const resultFor = (
    item: CatalogueItem,
    confidence: MatchConfidence,
    packSizeId: string | null,
    alternatives: string[]
  ): LineMatchResult => ({
    confidence,
    itemId: item.id,
    itemNumber: item.itemNumber,
    itemName: item.name,
    categoryName: item.categoryName,
    packSizeId,
    packs: packOptions(packsByItem.get(item.id) ?? [], unitById),
    alternatives: alternativesFor(alternatives),
  });

  const results: Record<string, LineMatchResult> = {};
  for (const line of input.lines) {
    // Something a person already settled — the offer an edited expense files
    // against, or an item picked from the options — is not second-guessed.
    const pinnedPackId = line.pricelistItemId ? packOfOffer.get(line.pricelistItemId) : undefined;
    const pinnedPack = pinnedPackId ? packById.get(pinnedPackId) : undefined;
    const pinnedItem = pinnedPack
      ? itemById.get(pinnedPack.item_id)
      : line.itemId
        ? itemById.get(line.itemId)
        : undefined;
    if (pinnedItem) {
      results[line.key] = resultFor(
        pinnedItem,
        "sure",
        pinnedPack?.id ??
          choosePack(pinnedItem.packs, line.description, catalogueUnits, vendorPackIds, pinnedItem.name),
        []
      );
      continue;
    }

    const pick = matchLine(line, catalogue, known, vendorId);
    const item = pick.itemId ? itemById.get(pick.itemId) : undefined;
    results[line.key] = item
      ? resultFor(
          item,
          pick.confidence,
          choosePack(item.packs, line.description, catalogueUnits, vendorPackIds, item.name),
          pick.alternatives
        )
      : {
          confidence: "none",
          itemId: null,
          itemNumber: null,
          itemName: null,
          categoryName: null,
          packSizeId: null,
          packs: [],
          alternatives: alternativesFor(pick.alternatives),
        };
  }
  return results;
}

export type LineItemInput = {
  description: string;
  /**
   * What receipt extraction originally read for this line, before the
   * submitter touched it. Null for manually entered lines, and for lines left
   * exactly as extracted.
   *
   * Recorded as an extra wording for the matched item, so a correction teaches
   * the app something. Without it the misread text is discarded and the same
   * receipt next month fails to match all over again — see 0023.
   */
  originalDescription?: string | null;
  /**
   * The Pricelist offer the submitter picked from the item typeahead, if they
   * picked one. Null for a line whose description was typed or extracted
   * without choosing a suggestion, and cleared as soon as the description is
   * edited afterwards — a pin means "this line is that offer", which stops
   * being true the moment the wording changes underneath it.
   */
  pricelistItemId?: string | null;
  /**
   * The Pricelist item this line is, as the submit form matched it or the
   * submitter chose it. Used only when no pack was — see packSizeId.
   */
  itemId?: string | null;
  /**
   * The pack this line is, as the form matched it or the submitter chose it.
   * Filed against this expense's vendor's offer on that pack, adding one when
   * the vendor has none — so a line the form matched never becomes a new item
   * or pack size.
   */
  packSizeId?: string | null;
  /**
   * What this line is. Only "goods" is a purchase; the rest exist so the lines
   * add up to the total printed on the receipt — see migration 0026.
   */
  kind: StoredLineKind;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  categoryName: string | null;
  /** Read from the receipt per line, not apportioned from the total. */
  gstApplicable: boolean;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
};

export type AttachmentInput = {
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  sha256: string | null;
};

export type CreateExpenseInput = {
  vendorName: string;
  abn: string | null;
  invoiceNumber: string | null;
  receiptDate: string | null;
  /** Receipt, delivery docket, covering email — see migration 0028. */
  attachments: AttachmentInput[];
  /**
   * What the receipt says was paid. Captured, never computed: the line items
   * must account for it, and a charge that is not itemised gets its own line
   * rather than quietly changing this figure.
   */
  total: number;
  /** Free-text note from the submitter; see migration 0025. */
  submitterComment: string | null;
  /** Who to reimburse. Null only where nobody has chosen yet. */
  payee: PayeeChoice | null;
  lineItems: LineItemInput[];
};

/**
 * Turns the submitted lines into rows, computing money per line rather than
 * apportioning it from the receipt total.
 *
 * Charge lines are deliberately not matched against the Pricelist. A card
 * surcharge is not a product, and running it through matchOrCreateOffer would
 * file "CREDIT SURCHARGE" as a pending item under the vendor — noise in the
 * catalogue that a person would then have to reject, once per receipt.
 */
async function buildLineRows(
  admin: ReturnType<typeof createAdminClient>,
  input: CreateExpenseInput,
  vendorId: string,
  userId: string
) {
  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryIdByName = new Map(
    leafCategories(categories ?? []).map((c) => [c.name.toLowerCase(), c.id])
  );

  const rows = [];
  for (const [index, item] of input.lineItems.entries()) {
    const categoryId = item.categoryName
      ? (categoryIdByName.get(item.categoryName.toLowerCase()) ?? null)
      : null;

    let pricelistItemId: string | null = null;
    let resolvedCategoryId = categoryId;

    if (item.kind === "goods") {
      // A pinned offer is the submitter naming the pack from the Pricelist
      // while looking at the invoice — better evidence than the wording, so it
      // is tried first. A pin that no longer resolves falls through to
      // matching rather than failing the submission.
      //
      // A pack the form matched or the submitter picked comes next, and an item
      // without a pack after that. Only a line nothing was found for reaches
      // matchOrCreateOffer, which is the one path that can add an item.
      const pin = {
        vendorId,
        description: item.description,
        originalDescription: item.originalDescription ?? null,
        userId,
        normalizedUnit: item.normalizedUnit,
        line: {
          lineTotal: item.lineTotal,
          quantity: item.quantity,
          normalizedQuantity: item.normalizedQuantity,
        },
      };
      const chosen =
        (item.pricelistItemId ? await chosenOffer(admin, { ...pin, offerId: item.pricelistItemId }) : null) ??
        (item.packSizeId ? await chosenPack(admin, { ...pin, packSizeId: item.packSizeId }) : null) ??
        (item.itemId ? await chosenItem(admin, { ...pin, itemId: item.itemId }) : null);

      const matched = chosen ?? (await matchOrCreateOffer(admin, {
        vendorId,
        originalDescription: item.originalDescription ?? null,
        description: item.description,
        categoryId,
        userId,
        normalizedUnit: item.normalizedUnit,
        // The receipt states what was bought and for how much, so an offer it
        // creates should not open with an empty price waiting to be typed back
        // in. What that means for the pack is worked out there — see
        // offerPackPrice.
        line: {
          lineTotal: item.lineTotal,
          quantity: item.quantity,
          normalizedQuantity: item.normalizedQuantity,
        },
      }));
      pricelistItemId = matched.id;
      // Prefer the category of the item this line resolved to. When the line
      // matched something a person has already classified, that beats whatever
      // the receipt suggested — and when extraction returned "unclear" there is
      // nothing to prefer, so an existing item's category fills the gap.
      resolvedCategoryId = matched.categoryId ?? categoryId;
    }

    const money = { kind: item.kind, lineTotal: item.lineTotal, gstApplicable: item.gstApplicable };
    rows.push({
      pricelist_item_id: pricelistItemId,
      description_raw: item.description,
      category_id: resolvedCategoryId,
      kind: item.kind,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_subtotal: lineSubtotal(money),
      line_gst: lineGst(money),
      line_total: item.lineTotal,
      gst_applicable: item.gstApplicable,
      normalized_quantity: item.normalizedQuantity,
      normalized_unit: item.normalizedUnit,
      sort_order: index,
    });
  }
  return rows;
}

/** Shared validation, so create and update cannot drift apart. */
function validate(input: CreateExpenseInput): string | null {
  if (!input.vendorName.trim()) return "Vendor is required.";
  if (input.lineItems.length === 0) return "Add at least one line item.";

  const balance = reconcile(
    input.lineItems.map((l) => ({
      kind: l.kind,
      lineTotal: l.lineTotal,
      gstApplicable: l.gstApplicable,
    })),
    input.total
  );
  if (!balance.balanced) {
    const gap = Math.abs(balance.difference).toFixed(2);
    return balance.difference > 0
      ? `The line items come to $${balance.lineSum.toFixed(2)}, but the receipt total is $${input.total.toFixed(2)} — $${gap} is unaccounted for. Add it as a charge, or correct a line.`
      : `The line items come to $${balance.lineSum.toFixed(2)}, which is $${gap} more than the receipt total of $${input.total.toFixed(2)}. Check for a discount that needs recording, or a duplicated line.`;
  }
  return null;
}

export async function createExpense(
  input: CreateExpenseInput
): Promise<{ error: string } | { expenseId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const admin = createAdminClient();

  const vendor = await matchOrCreateVendor(admin, {
    name: input.vendorName,
    abn: input.abn,
    userId: user.id,
  });

  const lines = await buildLineRows(admin, input, vendor.id, user.id);
  const payeeId = await resolvePayee(admin, input.payee, user, {
    id: vendor.id,
    name: input.vendorName.trim(),
  });
  const gstAmount = sumLineGst(lines.map((l) => ({
    kind: l.kind,
    lineTotal: l.line_total,
    gstApplicable: l.gst_applicable,
  })));

  // One transaction rather than 1 + 2N round trips to Sydney, and the sum
  // check runs inside it — see migration 0031.
  const { data, error } = await admin
    .rpc("create_expense_with_lines", {
      p_submitted_by: user.id,
      p_vendor_id: vendor.id,
      p_vendor_name_raw: input.vendorName,
      p_invoice_number: input.invoiceNumber,
      p_receipt_date: input.receiptDate,
      p_subtotal: round2(input.total - gstAmount),
      p_gst_amount: gstAmount,
      p_total: input.total,
      p_submitter_comment: input.submitterComment,
      p_payee_id: payeeId,
      p_fiscal_year_hijri: fiscalYearForReceipt(input.receiptDate),
      p_lines: lines,
      p_attachments: toAttachmentRows(input.attachments),
    })
    .single();

  if (error || !data) {
    await reportError({ source: "expense-create", error: error ?? "no row returned", userId: user.id });
    return { error: error?.message ?? "Could not create the expense." };
  }

  const created = data as { id: string; expense_number: string };

  await notifyExpenseSubmitted({
    id: created.id,
    expense_number: created.expense_number,
    vendor_name_raw: input.vendorName,
    total: input.total,
    submitted_by: user.id,
  });

  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidateReports();
  return { expenseId: created.id };
}

function toAttachmentRows(attachments: AttachmentInput[]) {
  return attachments.map((a) => ({
    storage_path: a.storagePath,
    file_name: a.fileName,
    content_type: a.contentType,
    size_bytes: a.sizeBytes,
    sha256: a.sha256,
  }));
}

export type ExpenseForEdit = CreateExpenseInput & { id: string };

/** Fetch an expense + line items for editing — only while it's still "submitted" (§3). */
export async function getExpenseForEdit(expenseId: string): Promise<ExpenseForEdit | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");

  const admin = createAdminClient();
  const { data: expense } = await admin.from("expenses").select("*").eq("id", expenseId).maybeSingle();
  if (!expense || expense.submitted_by !== user.id || expense.status !== "submitted") return null;

  const [{ data: lineItems }, { data: attachments }] = await Promise.all([
    admin
      .from("expense_line_items")
      .select(
        "description_raw, pricelist_item_id, kind, quantity, unit_price, line_total, category_id, gst_applicable, normalized_quantity, normalized_unit"
      )
      .eq("expense_id", expenseId)
      .order("sort_order"),
    admin
      .from("expense_attachments")
      .select("storage_path, file_name, content_type, size_bytes, sha256")
      .eq("expense_id", expenseId)
      .order("sort_order"),
  ]);

  const categoryIds = [...new Set((lineItems ?? []).map((li) => li.category_id).filter(Boolean))];
  const { data: categories } = categoryIds.length
    ? await admin.from("categories").select("id, name").in("id", categoryIds)
    : { data: [] };
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));

  return {
    id: expense.id,
    vendorName: expense.vendor_name_raw ?? "",
    abn: null,
    invoiceNumber: expense.invoice_number,
    receiptDate: expense.receipt_date,
    attachments: (attachments ?? []).map((a) => ({
      storagePath: a.storage_path,
      fileName: a.file_name,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      sha256: a.sha256,
    })),
    total: Number(expense.total),
    submitterComment: expense.submitter_comment,
    payee: expense.payee_id ? { kind: "existing", payeeId: expense.payee_id } : null,
    lineItems: (lineItems ?? []).map((li) => ({
      description: li.description_raw,
      // Kept so an edit shows what each line is already filed against, rather
      // than reading the wording afresh and possibly landing somewhere else.
      pricelistItemId: li.pricelist_item_id,
      kind: (li.kind ?? "goods") as StoredLineKind,
      quantity: li.quantity,
      unitPrice: li.unit_price,
      lineTotal: Number(li.line_total),
      categoryName: li.category_id ? (categoryNameById.get(li.category_id) ?? null) : null,
      // Null on rows written before 0026, whose GST was apportioned. Treated
      // as GST-free so an edit does not silently invent a credit; the
      // reconciliation strip shows the submitter what it now adds up to.
      gstApplicable: li.gst_applicable === true,
      normalizedQuantity: li.normalized_quantity,
      normalizedUnit: li.normalized_unit,
    })),
  };
}

export async function updateExpense(
  expenseId: string,
  input: CreateExpenseInput
): Promise<{ error: string } | { expenseId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");

  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const admin = createAdminClient();

  const vendor = await matchOrCreateVendor(admin, {
    name: input.vendorName,
    abn: input.abn,
    userId: user.id,
  });

  const lines = await buildLineRows(admin, input, vendor.id, user.id);
  const payeeId = await resolvePayee(admin, input.payee, user, {
    id: vendor.id,
    name: input.vendorName.trim(),
  });
  const gstAmount = sumLineGst(lines.map((l) => ({
    kind: l.kind,
    lineTotal: l.line_total,
    gstApplicable: l.gst_applicable,
  })));

  // Ownership and status are re-checked inside the function against a locked
  // row, which closes the window between an approver deciding and a submitter
  // saving an edit they opened beforehand.
  const { error } = await admin.rpc("update_expense_with_lines", {
    p_expense_id: expenseId,
    p_actor: user.id,
    p_vendor_id: vendor.id,
    p_vendor_name_raw: input.vendorName,
    p_invoice_number: input.invoiceNumber,
    p_receipt_date: input.receiptDate,
    p_subtotal: round2(input.total - gstAmount),
    p_gst_amount: gstAmount,
    p_total: input.total,
    p_submitter_comment: input.submitterComment,
    p_payee_id: payeeId,
    p_fiscal_year_hijri: fiscalYearForReceipt(input.receiptDate),
    p_lines: lines,
    p_attachments: toAttachmentRows(input.attachments),
  });

  if (error) {
    // The function raises when the expense has moved on, which is a normal
    // race rather than a fault worth reporting.
    if (/can no longer be edited|belongs to someone else/.test(error.message)) {
      return { error: "This expense can no longer be edited." };
    }
    await reportError({ source: "expense-update", error, userId: user.id, expenseId });
    return { error: error.message };
  }

  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidateReports();
  return { expenseId };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                  */
/* ------------------------------------------------------------------ */

export type DuplicateWarning = {
  expenseId: string;
  expenseNumber: string | null;
  vendorName: string;
  total: number;
  status: string;
  submittedByName: string;
  receiptDate: string | null;
  /** Why we think it is the same: identical file, or same vendor and invoice. */
  reason: "same-file" | "same-invoice";
};

/**
 * Whether this looks like something already submitted.
 *
 * Warns rather than blocks. A repeated vendor/invoice pair is usually a double
 * submission and occasionally legitimate — a supplier restarting their
 * numbering each year, a genuine same-day repeat order — and a hard block
 * would eventually stop a real expense with no way through.
 *
 * Two signals, strongest first. Identical file bytes are the same photograph
 * of the same receipt, which is a firmer answer than an invoice number a
 * supplier may reuse.
 */
export async function findPossibleDuplicates(input: {
  sha256List: string[];
  vendorName: string | null;
  invoiceNumber: string | null;
  excludeExpenseId?: string | null;
}): Promise<DuplicateWarning[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await userCan(user, "submit_expense", "submit"))) return [];

  const admin = createAdminClient();
  const found = new Map<string, DuplicateWarning["reason"]>();

  for (const sha of input.sha256List.filter(Boolean)) {
    for (const id of await expenseIdsWithFile(admin, sha)) found.set(id, "same-file");
  }

  const invoice = input.invoiceNumber?.trim();
  if (invoice && input.vendorName?.trim()) {
    const { data: vendors } = await admin
      .from("vendors")
      .select("id")
      .ilike("name", input.vendorName.trim())
      .limit(5);
    const vendorIds = (vendors ?? []).map((v) => v.id);
    if (vendorIds.length) {
      const { data } = await admin
        .from("expenses")
        .select("id")
        .in("vendor_id", vendorIds)
        .ilike("invoice_number", invoice)
        .neq("status", "declined")
        .limit(5);
      for (const row of data ?? []) if (!found.has(row.id)) found.set(row.id, "same-invoice");
    }
  }

  if (input.excludeExpenseId) found.delete(input.excludeExpenseId);
  if (found.size === 0) return [];

  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_name_raw, total, status, receipt_date, submitted_by")
    .in("id", [...found.keys()]);

  const submitterIds = [...new Set((expenses ?? []).map((e) => e.submitted_by))];
  const { data: profiles } = submitterIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", submitterIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  return (expenses ?? []).map((e) => ({
    expenseId: e.id,
    expenseNumber: e.expense_number,
    vendorName: e.vendor_name_raw ?? "Unrecorded vendor",
    total: Number(e.total),
    status: e.status,
    submittedByName: nameById.get(e.submitted_by) ?? "someone else",
    receiptDate: e.receipt_date,
    reason: found.get(e.id)!,
  }));
}

/* ------------------------------------------------------------------ */
/* Payee lookup                                                         */
/* ------------------------------------------------------------------ */

export async function searchPayeesAction(query: string): Promise<PayeeSuggestion[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");
  return searchPayees(createAdminClient(), query);
}

/** The submitter's own payee record, so "reimburse me" can be pre-selected. */
export async function myPayeeAction(): Promise<PayeeSuggestion | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const admin = createAdminClient();
  const { data } = await admin.from("payees").select("id").eq("profile_id", user.id).maybeSingle();
  return data ? getPayee(admin, data.id as string) : null;
}
