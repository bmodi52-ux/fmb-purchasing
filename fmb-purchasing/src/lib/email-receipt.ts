import PostalMime from "postal-mime";
import { ACCEPTED_TYPES } from "@/lib/receipt-storage";

/**
 * A saved email, taken apart into the pieces extraction can read.
 *
 * The prompt has always described this case — "a forwarded email, printed to
 * PDF, whose body carries the instruction" — which means someone was doing the
 * conversion by hand, once per receipt, and the quality of the result depended
 * on how their PDF printer laid the message out. Accepting the .eml directly
 * removes the step and reads the original rather than a picture of it.
 *
 * The message body matters as much as anything attached to it. These uploads
 * are deliberate: people attach the email because the instruction lives in it
 * — "Please pay Miqdad Bhai", "pay Taj Mart directly $5065.76" — and sometimes
 * it is the only record of the amount, because there is no receipt at all.
 */

export type EmailReceipt = {
  /** Header lines plus the message body, as plain text for the model to read. */
  text: string;
  /** Attachments the model can actually look at — images and PDFs. */
  documents: { mediaType: string; base64: string; fileName: string }[];
  /**
   * Attachments that were skipped, so the reader can be told rather than left
   * wondering why an invoice it can see referenced never appeared.
   */
  skipped: { fileName: string; mediaType: string; reason: "unsupported" | "too-large" }[];
};

/**
 * The per-attachment ceiling.
 *
 * The API caps a document at 32MB, and a request carrying several of them is
 * subject to the same overall budget, so a single 30MB scan inside an email
 * would push everything else out. Five megabytes comfortably holds a
 * photographed invoice and stops one attachment monopolising the request.
 */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * How much of the message body to keep.
 *
 * Forwarded chains accumulate: quoted history, disclaimers, threads that run
 * for pages. The instruction is essentially always at the top, so the head of
 * the message is the part worth spending tokens on.
 */
const MAX_BODY_CHARS = 8000;

/** Attachment types the model can be shown. Anything else is named, not sent. */
const READABLE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Attachment content comes back as an ArrayBuffer normally, and as a string
 * when the part was base64 with `content: "base64"` requested — and the types
 * admit a Uint8Array too. All three are handled rather than cast away, because
 * getting this wrong turns an invoice into garbage the model reads as a
 * corrupt image.
 */
function bytesOf(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/**
 * Collapse an HTML body to something worth reading.
 *
 * Deliberately crude. This is a fallback for a message with no text/plain part
 * at all, and the goal is to recover the sentence that says who to pay — not
 * to render the email. Scripts and styles are dropped outright because their
 * contents would otherwise arrive as text.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEmailReceipt(bytes: Uint8Array): Promise<EmailReceipt> {
  const email = await PostalMime.parse(bytes);

  const header = [
    email.from ? `From: ${email.from.name || ""} <${email.from.address ?? ""}>`.trim() : null,
    email.to?.length
      ? `To: ${email.to.map((a) => a.address).filter(Boolean).join(", ")}`
      : null,
    email.date ? `Date: ${email.date}` : null,
    email.subject ? `Subject: ${email.subject}` : null,
  ].filter(Boolean);

  const body = (email.text ?? (email.html ? htmlToText(email.html) : "")).trim();
  const truncated = body.length > MAX_BODY_CHARS;

  const documents: EmailReceipt["documents"] = [];
  const skipped: EmailReceipt["skipped"] = [];

  for (const attachment of email.attachments ?? []) {
    const fileName = attachment.filename || "attachment";
    const mediaType = (attachment.mimeType || "").toLowerCase();

    if (!READABLE.has(mediaType)) {
      skipped.push({ fileName, mediaType, reason: "unsupported" });
      continue;
    }
    const raw = bytesOf(attachment.content);
    if (raw.byteLength > MAX_ATTACHMENT_BYTES) {
      skipped.push({ fileName, mediaType, reason: "too-large" });
      continue;
    }
    documents.push({
      mediaType,
      fileName,
      base64: Buffer.from(raw).toString("base64"),
    });
  }

  const notes = [
    ...documents.map((d) => `Attached: ${d.fileName} (${d.mediaType})`),
    ...skipped.map(
      (s) =>
        `Attached but not readable here: ${s.fileName} (${s.mediaType || "unknown type"}, ` +
        `${s.reason === "too-large" ? "too large to include" : "unsupported format"})`
    ),
  ];

  const text = [
    ...header,
    "",
    truncated ? `${body.slice(0, MAX_BODY_CHARS)}\n\n[message truncated]` : body,
    notes.length ? `\n${notes.join("\n")}` : "",
  ]
    .join("\n")
    .trim();

  return { text, documents, skipped };
}

/** Whether a stored file should be taken apart as an email rather than shown as-is. */
export function isEmail(mediaType: string): boolean {
  return mediaType === "message/rfc822";
}

/** Kept honest against the storage allow-list, which is what actually gates uploads. */
export const EMAIL_UPLOADS_ACCEPTED = ACCEPTED_TYPES.has("message/rfc822");
