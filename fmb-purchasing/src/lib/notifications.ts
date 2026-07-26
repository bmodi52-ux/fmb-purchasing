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
