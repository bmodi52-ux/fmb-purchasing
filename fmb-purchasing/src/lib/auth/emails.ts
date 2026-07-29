import { sendEmail, emailTemplate, detailsBox, SITE_URL } from "@/lib/notifications";

/**
 * The two messages that have to reach someone who *can't* sign in, and so
 * can't be in-app notifications like everything else in this app.
 */

export async function sendWelcomeEmail({
  to,
  fullName,
  temporaryPassword,
}: {
  to: string;
  fullName: string;
  temporaryPassword: string;
}): Promise<boolean> {
  return sendEmail({
    to,
    subject: "Welcome to FMB Sydney — your account is ready",
    html: emailTemplate(`
      <p style="margin:0 0 8px 0;">Hi ${fullName}, an account has been created for you on FMB Sydney.</p>
      ${detailsBox([
        { label: "Email address", value: to },
        { label: "Temporary password", value: temporaryPassword },
      ])}
      <p style="margin:8px 0 0 0;">Sign in at <a href="${SITE_URL}/login" style="color:#A97614;">${SITE_URL}</a>. You'll be asked to choose your own password straight away — the one above stops working once you do.</p>
    `),
  });
}

export async function sendTemporaryPasswordEmail({
  to,
  fullName,
  temporaryPassword,
}: {
  to: string;
  fullName: string;
  temporaryPassword: string;
}): Promise<boolean> {
  return sendEmail({
    to,
    subject: "Your FMB Sydney password has been reset",
    html: emailTemplate(`
      <p style="margin:0 0 8px 0;">Hi ${fullName}, an administrator has issued a new temporary password for your FMB Sydney account.</p>
      ${detailsBox([
        { label: "Email address", value: to },
        { label: "Temporary password", value: temporaryPassword },
      ])}
      <p style="margin:8px 0 0 0;">Sign in at <a href="${SITE_URL}/login" style="color:#A97614;">${SITE_URL}</a> and you'll be asked to choose a new password immediately.</p>
      <p style="margin:12px 0 0 0; color:#7A6B5C; font-size:13px;">If you weren't expecting this, tell an administrator — someone else requested it on your behalf.</p>
    `),
  });
}

export async function sendPasswordResetEmail({
  to,
  fullName,
  resetUrl,
}: {
  to: string;
  fullName: string;
  resetUrl: string;
}): Promise<boolean> {
  return sendEmail({
    to,
    subject: "Reset your FMB Sydney password",
    html: emailTemplate(`
      <p style="margin:0 0 14px 0;">Hi ${fullName}, we received a request to reset the password on your FMB Sydney account.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
        <tr>
          <td style="background-color:#C9962C; border-radius:6px;">
            <a href="${resetUrl}" style="display:inline-block; padding:11px 22px; color:#2B211C; font-weight:600; font-size:14px; text-decoration:none;">Choose a new password</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0; color:#7A6B5C; font-size:13px;">This link can only be used once, and expires after a while — request another if it's stopped working.</p>
      <p style="margin:0; color:#7A6B5C; font-size:13px;">If you didn't ask for this, you can ignore this email — your password won't change until the link above is used.</p>
      <p style="margin:14px 0 0 0; color:#9A8B7B; font-size:12px; word-break:break-all;">If the button doesn't work, paste this into your browser:<br />${resetUrl}</p>
    `),
  });
}
