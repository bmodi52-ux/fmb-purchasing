import type { SupabaseClient } from "@supabase/supabase-js";
import { detailsBox, emailTemplate, sendEmail } from "@/lib/notifications";
import { getSetting } from "@/lib/app-settings";

/**
 * Remittance advice (scratchpad #37): when a payee is paid, an email listing
 * what the transfer covered — so a supplier can match it to their invoices,
 * and a member can see which of their receipts were reimbursed, without
 * asking.
 *
 * Sent to the payee's remittance email; for a member being reimbursed with
 * none set, to their own login address. A payee with neither gets nothing.
 */

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendRemittanceAdvice(
  admin: SupabaseClient,
  paid: { id: string; expense_number: string | null; vendor_name_raw: string | null; total: number; payee_id: string | null }[],
  paymentDate: string,
  paymentReference: string | null
): Promise<void> {
  if (!(await getSetting(admin, "remittance_emails"))) return;

  const byPayee = new Map<string, typeof paid>();
  for (const e of paid) if (e.payee_id) byPayee.set(e.payee_id, [...(byPayee.get(e.payee_id) ?? []), e]);
  if (byPayee.size === 0) return;

  const [{ data: payees }, { data: invoices }] = await Promise.all([
    admin.from("payees").select("id, display_name, remittance_email, profile_id, profiles ( email )").in("id", [...byPayee.keys()]),
    admin.from("expenses").select("id, invoice_number, receipt_date").in("id", paid.map((e) => e.id)),
  ]);
  const invoiceOf = new Map((invoices ?? []).map((i) => [i.id as string, i]));

  for (const payee of payees ?? []) {
    const profile = payee.profiles as unknown as { email: string } | null;
    const to = (payee.remittance_email as string | null) || (payee.profile_id ? profile?.email : null);
    if (!to) continue;

    const list = byPayee.get(payee.id as string) ?? [];
    const total = list.reduce((s, e) => s + Number(e.total), 0);
    const rows = list
      .map((e) => {
        const inv = invoiceOf.get(e.id);
        const what = [e.expense_number, e.vendor_name_raw, inv?.invoice_number ? `invoice ${inv.invoice_number}` : null]
          .filter(Boolean)
          .map((s) => escape(String(s)))
          .join(" · ");
        return { label: what, value: money(Number(e.total)) };
      })
      .concat([{ label: "<strong>Total</strong>", value: `<strong>${money(total)}</strong>` }]);

    await sendEmail({
      to,
      subject: `Remittance advice — ${money(total)} from FMB Sydney`,
      html: emailTemplate(
        `<p style="margin:0 0 10px 0;">Salaam ${escape(payee.display_name as string)},</p>` +
          `<p style="margin:0 0 6px 0;">FMB Sydney has paid ${money(total)} on ${escape(
            new Date(`${paymentDate}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
          )}${paymentReference ? `, reference <strong>${escape(paymentReference)}</strong>` : ""}. It covers:</p>` +
          detailsBox(rows)
      ),
    });
  }
}
