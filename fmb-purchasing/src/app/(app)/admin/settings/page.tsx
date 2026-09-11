import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/app-settings";
import { SubmitButton } from "@/components/submit-button";
import { setCapitalThreshold, setDuplicateFlags } from "./actions";

export const metadata = { title: "App settings" };

/**
 * Settings that apply to everyone, changed without a deploy (0046).
 *
 * Gated like System errors: whoever administers accounts.
 */
export default async function AppSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");

  const settings = await getSettings(createAdminClient(), [
    "duplicate_flags_for_reviewers",
    "capital_purchase_threshold",
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">App settings</h1>
        <p className="page-description mt-1 max-w-xl">Settings that apply to everyone using the app.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Checks</h2>
        <SettingRow
          title="Warn approvers and payers about possible duplicates"
          description="Flags an expense on Approvals and Payments when another expense has the same receipt file, or the same vendor and invoice number. Declined and withdrawn expenses are ignored."
          on={settings.duplicate_flags_for_reviewers}
          action={setDuplicateFlags}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">GST</h2>
        <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-ink">Capital purchase threshold</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink/60">
              A line in a category marked &ldquo;capital purchases&rdquo; (Pricelist → Categories) at or above this
              amount, GST included, is marked as a capital purchase when submitted. The GST return reports capital
              purchases separately. Anyone who approves or pays can change it on the expense. Check the amount with
              FMB&apos;s accountant.
            </p>
          </div>
          <form action={setCapitalThreshold} className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm text-ink/70">
              $
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={settings.capital_purchase_threshold}
                aria-label="Capital purchase threshold in dollars"
                className="input w-28"
              />
            </label>
            <SubmitButton
              pendingLabel="Saving…"
              className="whitespace-nowrap rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30"
            >
              Save
            </SubmitButton>
          </form>
        </div>
      </section>
    </div>
  );
}

function SettingRow({
  title,
  description,
  on,
  action,
}: {
  title: string;
  description: string;
  on: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink/60">{description}</p>
      </div>
      <form action={action} className="flex items-center gap-3">
        <input type="hidden" name="on" value={String(!on)} />
        <span className={`text-xs font-medium ${on ? "text-palm" : "text-ink/50"}`}>{on ? "On" : "Off"}</span>
        <SubmitButton
          pendingLabel="Saving…"
          className="whitespace-nowrap rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30"
        >
          {on ? "Turn off" : "Turn on"}
        </SubmitButton>
      </form>
    </div>
  );
}
