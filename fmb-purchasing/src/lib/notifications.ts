// Email clients need a real, publicly-reachable URL for images — can't
// reference localhost or a relative path. Update this if the domain changes.
//
// Overridable so a local build can send itself a working password-reset link;
// unset (as in production) it stays the live domain.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.fmbpurchasing.com.au";

/**
 * Wraps a notification's body HTML in the FMB branded header/footer.
 * Table-based layout + inline styles throughout, since email clients strip
 * <style> blocks and don't support flexbox/grid — this is the standard,
 * lowest-common-denominator approach for HTML email.
 */
/** Sans stack that resolves to the host OS UI face — the closest an email can
 *  get to the Inter used in the app, since webfonts are unreliable in mail. */
const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function emailTemplate(bodyHtml: string): string {
  return `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0; padding:0; background-color:#FFFFFF; font-family:${EMAIL_FONT};">
    <!-- A narrow card floating in a wide field of brand colour looks stranded on
         a desktop client. Neutral surround, left-aligned card, and a modest
         600px measure so it reads as a letter rather than a coloured slab. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF; padding:24px 16px;">
      <tr>
        <td align="left">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; border:1px solid #EFE7D8; border-radius:10px; overflow:hidden;">
            <tr>
              <td style="padding:18px 24px; background-color:#FBF6EC; border-bottom:1px solid #EFE7D8;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px; vertical-align:middle;">
                      <img src="${SITE_URL}/fmb-logo.png" width="32" height="32" alt="FMB" style="display:block; border-radius:4px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:16px; font-weight:bold; color:#2B211C; letter-spacing:-0.01em;">FMB Sydney</p>
                      <p style="margin:1px 0 0 0; font-size:11px; color:#8A7B6C;">Faiz ul Mawaid il Burhaniyah</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 24px; font-family:${EMAIL_FONT}; font-size:15px; line-height:1.55; color:#2B211C;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px; border-top:1px solid #EFE7D8; background-color:#FCFAF5;">
                <p style="margin:0; font-family:${EMAIL_FONT}; font-size:11px; line-height:1.5; color:#9A8B7B;">Automated message from FMB Sydney — please don&rsquo;t reply to this address.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A bordered white key/value box for a handful of rows — vendor/total, email/password, etc. */
export function detailsBox(rows: { label: string; value: string }[]): string {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
      <tr>
        <td style="padding:5px 0; font-family:${EMAIL_FONT}; color:#7A6B5C; font-size:13px;">${label}</td>
        <td style="padding:5px 0; font-family:${EMAIL_FONT}; color:#2B211C; font-size:13px; text-align:right; font-weight:600;">${value}</td>
      </tr>`
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FCFAF5; border:1px solid #EFE7D8; border-radius:8px; padding:10px 14px; margin:14px 0;">
      ${rowsHtml}
    </table>`;
}

/**
 * Email via Resend. Degrades gracefully — if RESEND_API_KEY isn't set, sends
 * are skipped (logged) rather than failing.
 *
 * As of the in-app notifications work the only callers are the account
 * messages in lib/auth/emails.ts: a welcome, an admin-issued temporary
 * password, and a password-reset link. Expense submissions, decisions and
 * payments no longer send mail; they write notifications the user reads in
 * the app instead. These three can't move in-app, since their whole purpose
 * is to reach someone who can't sign in yet.
 *
 * Returns whether the message was actually accepted, because a caller that
 * has just minted a temporary password needs to know if that password
 * reached anyone — it isn't recoverable afterwards.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = Array.isArray(to) ? to : [to];
  if (!apiKey || recipients.length === 0) {
    console.log(`[notifications] skipped "${subject}" to ${recipients.join(", ") || "(none)"} (RESEND_API_KEY not set)`);
    return false;
  }

  const from = process.env.RESEND_FROM_EMAIL || "FMB Sydney <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    if (!res.ok) {
      // Imported lazily: lib/errors imports the notification helpers, and a
      // top-level import here would close that cycle.
      const { reportError } = await import("@/lib/errors");
      await reportError({
        source: "email-send",
        error: `Resend returned ${res.status}: ${await res.text()}`,
        detail: `subject: ${subject}`,
      });
      return false;
    }
    return true;
  } catch (err) {
    const { reportError } = await import("@/lib/errors");
    await reportError({ source: "email-send", error: err, detail: `subject: ${subject}` });
    return false;
  }
}
