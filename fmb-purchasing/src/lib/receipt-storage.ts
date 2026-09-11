import { createHash } from "node:crypto";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIPTS_BUCKET = "receipts";

/**
 * What may be uploaded as a receipt.
 *
 * message/rfc822 is a saved email, and it is here because it is what people
 * were already sending: the extraction prompt has always described "a
 * forwarded email, printed to PDF, whose body carries the instruction", which
 * is a manual conversion step someone was performing on every such receipt.
 * The covering message routinely holds what the receipt does not — who to pay,
 * what the payment is for, sometimes the amount, when there is no receipt at
 * all — so the email is the document, not a wrapper around one.
 */
export const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "message/rfc822",
]);

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "message/rfc822": "eml",
};

/**
 * The type a browser *should* have reported.
 *
 * Chrome gives a .eml file "message/rfc822", but Windows hands over an empty
 * string when no application is registered for the extension, and dragging one
 * out of some mail clients yields "application/octet-stream". Rejecting those
 * would refuse the file for a reason the person cannot see or fix, so the
 * extension decides when the browser declines to.
 */
export function receiptContentType(fileName: string, reportedType: string): string {
  if (ACCEPTED_TYPES.has(reportedType)) return reportedType;
  return /\.eml$/i.test(fileName) ? "message/rfc822" : reportedType;
}

export type StoredFile = {
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  /** True when these exact bytes were already in the bucket. */
  alreadyStored: boolean;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Where a receipt with these bytes lives in the bucket.
 *
 * Derived entirely from the content hash, so it can be recomputed rather than
 * taken on trust. That is what lets the extraction action accept "read the file
 * I just uploaded" from a browser: the path is recomputed from the hash the
 * browser quotes, so no path of the caller's choosing is ever followed.
 */
export function receiptStoragePath(sha256: string, contentType: string): string {
  const extension = EXTENSIONS[contentType] ?? "bin";
  return `sha256/${sha256.slice(0, 2)}/${sha256}.${extension}`;
}

/**
 * Store a receipt under a key derived from its own bytes.
 *
 * The old key was `<user>/<epoch-millis>-<filename>`, which made every upload
 * a new object. That mattered because the file is written *before* extraction
 * runs and kept whether extraction succeeds or fails: someone on a slow
 * connection who taps the upload area twice — it was never disabled while a
 * request was in flight — left two copies, and someone who then abandoned the
 * form left both behind with nothing in the database pointing at them.
 * Unreachable, uncountable, and permanent.
 *
 * Content-addressing makes the retry idempotent, and pays for itself three
 * more times over: the extraction cache can key on the hash so a repeat costs
 * nothing and returns instantly, duplicate detection gets a signal stronger
 * than vendor-plus-invoice-number, and an abandoned upload is at worst one
 * orphan per distinct file rather than one per attempt.
 *
 * Sharded by the first two hex characters purely so the bucket does not become
 * one directory with tens of thousands of siblings.
 */
export async function storeReceiptFile(
  admin: SupabaseClient,
  file: { bytes: Uint8Array; name: string; type: string }
): Promise<StoredFile> {
  const sha256 = sha256Hex(file.bytes);
  const storagePath = receiptStoragePath(sha256, file.type);

  const { error } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .upload(storagePath, file.bytes, { contentType: file.type, upsert: true });

  // `upsert` makes a re-upload of identical bytes a no-op rather than a
  // conflict, so this only fires on a real storage failure.
  if (error) throw new Error(error.message);

  return {
    storagePath,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.bytes.byteLength,
    sha256,
    alreadyStored: false,
  };
}

/**
 * Expenses that already carry a file with these bytes.
 *
 * The strongest duplicate signal available: identical bytes are the same
 * photograph of the same receipt. Declined expenses are excluded — a receipt
 * that was turned down and is being resubmitted correctly is not a duplicate.
 */
export async function expenseIdsWithFile(
  admin: SupabaseClient,
  sha256: string
): Promise<string[]> {
  const { data } = await admin
    .from("expense_attachments")
    .select("expense_id, expenses!inner ( status )")
    .eq("sha256", sha256)
    .not("expenses.status", "in", NOT_SPEND_FILTER);

  return [...new Set((data ?? []).map((row) => row.expense_id as string))];
}

/**
 * Which of these expenses have a file attached.
 *
 * One query for a whole page of rows: the list pages only need to know whether
 * to show a link, and asking per row would be a round trip each. Lives here
 * rather than beside the signing helpers because it takes a client, and every
 * export of a "use server" module has to be a server action with serializable
 * arguments.
 */
export async function expenseIdsWithAttachments(
  admin: SupabaseClient,
  expenseIds: string[]
): Promise<Set<string>> {
  if (expenseIds.length === 0) return new Set();
  const { data } = await admin
    .from("expense_attachments")
    .select("expense_id")
    .in("expense_id", expenseIds);
  return new Set((data ?? []).map((r) => r.expense_id as string));
}


