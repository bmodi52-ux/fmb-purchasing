// Email clients need a real, publicly-reachable URL for images — can't
// reference localhost or a relative path. Update this if the domain changes.
export const SITE_URL = "https://www.fmbpurchasing.com.au";

/**
 * Wraps a notification's body HTML in the FMB branded header/footer.
 * Table-based layout + inline styles throughout, since email clients strip
 * <style> blocks and don't support flexbox/grid — this is the standard,
 * lowest-common-denominator approach for HTML email.
 */
export function emailTemplate(bodyHtml: string): string {
  return `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#F5EEDE; font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5EEDE; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#FBF6EC; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 16px 32px; border-bottom:2px solid #D89C24;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;">
                      <img src="${SITE_URL}/fmb-logo.png" width="40" height="40" alt="FMB" style="display:block; border-radius:4px;" />
                    </td>
                    <td>
                      <p style="margin:0; font-size:18px; font-weight:bold; color:#2B211C;">FMB Purchasing</p>
                      <p style="margin:0; font-size:12px; color:#6E5F52;">Faiz ul Mawaid il Burhaniyah</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px; font-family:Georgia,'Times New Roman',serif; font-size:14px; line-height:1.6; color:#2B211C;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px; border-top:1px solid #E7DCC5;">
                <p style="margin:0; font-size:11px; color:#948572;">This is an automated message from FMB Purchasing. Please don't reply directly to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A bordered white key/value box for a handful of rows — vendor/total, username/password, etc. */
export function detailsBox(rows: { label: string; value: string }[]): string {
  const rowsHtml = rows
    .map(
      ({ label, value }) => `
      <tr>
        <td style="padding:4px 0; color:#6E5F52; font-size:13px;">${label}</td>
        <td style="padding:4px 0; color:#2B211C; font-size:13px; text-align:right; font-weight:bold;">${value}</td>
      </tr>`
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF; border:1px solid #E7DCC5; border-radius:6px; padding:12px 16px; margin:16px 0;">
      ${rowsHtml}
    </table>`;
}

/**
 * Email notifications (§7) via Resend. Degrades gracefully — if
 * RESEND_API_KEY isn't set, sends are skipped (logged) rather than
 * failing, so the rest of the app works before this is configured.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = Array.isArray(to) ? to : [to];
  if (!apiKey || recipients.length === 0) {
    console.log(`[notifications] skipped "${subject}" to ${recipients.join(", ") || "(none)"} (RESEND_API_KEY not set)`);
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || "FMB Purchasing <onboarding@resend.dev>";

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
      console.error(`[notifications] Resend send failed (${res.status}):`, await res.text());
    }
  } catch (err) {
    console.error("[notifications] Resend send threw:", err);
  }
}
