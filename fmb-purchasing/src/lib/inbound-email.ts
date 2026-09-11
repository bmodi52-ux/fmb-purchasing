import type { SupabaseClient } from "@supabase/supabase-js";
import PostalMime from "postal-mime";
import { parseEmailReceipt } from "@/lib/email-receipt";
import { storeReceiptFile } from "@/lib/receipt-storage";

/**
 * Receipts forwarded to the app's email address (#49).
 *
 * An email provider receives the message and posts it, whole, to
 * /api/inbound-email. The sender is matched to a member by their contact
 * address; the message is kept as a receipt file — the same .eml upload
 * Submit already reads — and waits on that member's Submit page. Nothing is
 * submitted for them: it is a draft until they check it and press Submit.
 *
 * A stranger's email is dropped without a trace. A forged From line from a
 * member's address can at worst leave a draft that member dismisses, and a
 * message the provider marks as failing DMARC is refused outright.
 */

export type InboundOutcome =
  | { status: "stored"; id: string; userId: string }
  | { status: "duplicate"; id: string }
  | { status: "unknown_sender" }
  | { status: "not_allowed" }
  | { status: "failed_authentication" }
  | { status: "unreadable" };

/**
 * Whether the receiving provider says the sender was forged. Only a verdict
 * that is actually present counts: many providers add no such header, and its
 * absence proves nothing either way.
 */
export function failsAuthentication(headerValues: string[]): boolean {
  const text = headerValues.join(";").toLowerCase();
  if (/\bdmarc=fail\b/.test(text)) return true;
  return /\bspf=fail\b/.test(text) && !/\bdkim=pass\b/.test(text);
}

/** The address a message is from, lowercased, or null when it has none. */
export function senderOf(from: { address?: string | null } | null | undefined): string | null {
  const address = from?.address?.trim().toLowerCase();
  return address && address.includes("@") ? address : null;
}

/** A readable file name for the stored message: its subject, tidied. */
export function messageFileName(subject: string | null | undefined): string {
  const base = (subject ?? "")
    .replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, "")
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "Emailed receipt"}.eml`;
}

export async function acceptInboundEmail(
  admin: SupabaseClient,
  bytes: Uint8Array,
  canSubmit: (user: { id: string; teamIds: string[] }) => Promise<boolean>
): Promise<InboundOutcome> {
  let parsed;
  try {
    parsed = await PostalMime.parse(bytes);
  } catch {
    return { status: "unreadable" };
  }

  const authentication = (parsed.headers ?? [])
    .filter((h) => h.key.toLowerCase() === "authentication-results")
    .map((h) => h.value);
  if (failsAuthentication(authentication)) return { status: "failed_authentication" };

  const from = senderOf(parsed.from);
  if (!from) return { status: "unknown_sender" };

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, is_active")
    // Escaped, since an underscore in an address is a wildcard to ilike; the
    // exact comparison below is what decides.
    .ilike("email", from.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(5);
  const active = (profiles ?? []).filter((p) => p.is_active && String(p.email).trim().toLowerCase() === from);
  // Two accounts sharing an address can't be told apart, so neither gets it.
  if (active.length !== 1) return { status: "unknown_sender" };
  const userId = active[0].id as string;

  const { data: memberships } = await admin.from("team_members").select("team_id").eq("user_id", userId);
  if (!(await canSubmit({ id: userId, teamIds: (memberships ?? []).map((m) => m.team_id as string) }))) {
    return { status: "not_allowed" };
  }

  const receipt = await parseEmailReceipt(bytes);
  const stored = await storeReceiptFile(admin, { bytes, name: messageFileName(parsed.subject), type: "message/rfc822" });

  const { data: existing } = await admin
    .from("inbound_receipts")
    .select("id")
    .eq("user_id", userId)
    .eq("sha256", stored.sha256)
    .maybeSingle();
  if (existing) return { status: "duplicate", id: existing.id as string };

  const { data: row, error } = await admin
    .from("inbound_receipts")
    .insert({
      user_id: userId,
      from_email: from,
      subject: parsed.subject?.slice(0, 300) ?? null,
      storage_path: stored.storagePath,
      sha256: stored.sha256,
      file_name: stored.fileName,
      size_bytes: stored.sizeBytes,
      attachment_count: receipt.documents.length,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "The emailed receipt could not be recorded.");
  return { status: "stored", id: row.id as string, userId };
}

/**
 * Marks emailed-in receipts as used once an expense carries their file, so
 * they leave the waiting list without anyone having to dismiss them.
 */
export async function markInboundReceiptsUsed(
  admin: SupabaseClient,
  userId: string,
  sha256s: (string | null | undefined)[],
  expenseId: string
): Promise<void> {
  const hashes = [...new Set(sha256s.filter((s): s is string => !!s))];
  if (hashes.length === 0) return;
  await admin
    .from("inbound_receipts")
    .update({ status: "used", expense_id: expenseId, handled_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "waiting")
    .in("sha256", hashes);
}
