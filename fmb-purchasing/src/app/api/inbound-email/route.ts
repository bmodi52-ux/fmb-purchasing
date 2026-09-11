import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptInboundEmail } from "@/lib/inbound-email";
import { can, getUserPermissions } from "@/lib/permissions";
import { notify } from "@/lib/notifications-inapp";
import { reportError } from "@/lib/errors";

/**
 * Where the email provider posts a receipt someone forwarded (#49). See
 * docs/receipts-by-email.md for setting the address up.
 *
 * Takes the whole message as it arrived (RFC 822): as the request body, or as
 * the "email" field of a form post, which is how SendGrid's Inbound Parse
 * sends it with "POST the raw, full MIME message" ticked. Refused without
 * INBOUND_EMAIL_SECRET, given as a bearer token, an x-inbound-secret header,
 * or ?key= for providers that can only be given a URL.
 *
 * Answers 200 for anything it chose not to keep, with the reason, so the
 * provider neither retries nor bounces mail to strangers.
 */
export const dynamic = "force-dynamic";

/** Vercel refuses request bodies over about 4.5 MB before this runs. */
const MAX_BYTES = 4.5 * 1024 * 1024;

function authorised(request: Request): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return false;
  const given =
    request.headers.get("x-inbound-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("key") ??
    "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function messageBytes(request: Request): Promise<Uint8Array | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const field = form.get("email");
    if (typeof field === "string") return new TextEncoder().encode(field);
    if (field instanceof File) return new Uint8Array(await field.arrayBuffer());
    return null;
  }
  return new Uint8Array(await request.arrayBuffer());
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ status: "too_large" }, { status: 413 });

  const bytes = await messageBytes(request);
  if (!bytes || bytes.byteLength === 0) return Response.json({ status: "empty" }, { status: 400 });
  if (bytes.byteLength > MAX_BYTES) return Response.json({ status: "too_large" }, { status: 413 });

  const admin = createAdminClient();
  try {
    const outcome = await acceptInboundEmail(admin, bytes, async (user) =>
      can(await getUserPermissions(user), "submit_expense", "submit")
    );
    if (outcome.status === "stored") {
      await notify(admin, [
        {
          userId: outcome.userId,
          kind: "receipt_received",
          title: "Your emailed receipt is ready to submit",
          body: "Check what was read, then submit it.",
          link: `/submit?inbound=${outcome.id}`,
        },
      ]);
    }
    return Response.json({ status: outcome.status });
  } catch (err) {
    await reportError({ source: "inbound-email", error: err, detail: `${bytes.byteLength} bytes` });
    return Response.json({ status: "failed" }, { status: 500 });
  }
}
