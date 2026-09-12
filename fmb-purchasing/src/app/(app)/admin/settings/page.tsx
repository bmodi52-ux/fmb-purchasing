import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/app-settings";
import { SubmitButton } from "@/components/submit-button";
import {
  setAbaSettings,
  setBudgetAlerts,
  setCapitalThreshold,
  setDuplicateFlags,
  setReminders,
  setRemittanceEmails,
  setExtractionCheck,
  runExtractionCheckNow,
} from "./actions";
import { accuracy } from "@/lib/extraction-scoring";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "App settings" };

// Starting the receipt-reading check reads a few receipts after the response.
export const maxDuration = 300;

/**
 * Settings that apply to everyone, changed without a deploy (0046).
 *
 * Gated like System errors: whoever administers accounts.
 */
export default async function AppSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "app_settings", "view");

  const admin = createAdminClient();
  const [settings, { data: teams }, { data: lastRun }] = await Promise.all([
    getSettings(admin, [
      "duplicate_flags_for_reviewers",
      "capital_purchase_threshold",
      "reminders",
      "aba",
      "remittance_emails",
      "budget_alerts",
      "extraction_check",
    ]),
    admin.from("teams").select("id, name").order("name"),
    admin.from("scheduled_runs").select("last_run_at, summary").eq("job", "daily").maybeSingle(),
  ]);
  const r = settings.reminders;

  const [{ count: checkReceiptCount }, { data: checkRuns }] = await Promise.all([
    admin.from("extraction_benchmark_cases").select("id", { count: "exact", head: true }).eq("active", true),
    admin
      .from("extraction_benchmark_runs")
      .select("id, started_at, finished_at, model, case_count, checks, passed, failed_cases, extraction_benchmark_results ( case_id )")
      .order("started_at", { ascending: false })
      .limit(5),
  ]);
  const ec = settings.extraction_check;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">App settings</h1>
        <p className="page-description mt-1 max-w-xl">Settings that apply to everyone using the app.</p>
      </div>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Payments</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            FMB&apos;s own account, for the batch payment (ABA) files the Payments page downloads. The user ID is the
            six-digit number your bank issues for batch payments — ask the bank if you don&apos;t have it.
          </p>
        </div>
        <form action={setAbaSettings} className="grid gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-4 text-sm sm:grid-cols-2">
          {(
            [
              ["bank", "Bank code (e.g. NAB, CBA, WBC, ANZ)", settings.aba.bankAbbreviation, 3],
              ["user_name", "FMB's name as the bank has it", settings.aba.userName, 26],
              ["user_id", "Batch payment user ID (6 digits)", settings.aba.userId, 6],
              ["bsb", "FMB's BSB", settings.aba.bsb, 7],
              ["account_number", "FMB's account number", settings.aba.accountNumber, 9],
              ["remitter_name", "Sender name payees see", settings.aba.remitterName, 16],
              ["description", "Batch description", settings.aba.description, 12],
            ] as const
          ).map(([name, label, value, max]) => (
            <label key={name} className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">{label}</span>
              <input name={name} defaultValue={value} maxLength={max} className="input text-sm" />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="balancing" defaultChecked={settings.aba.balancing} />
            Add a balancing line taking the total from FMB&apos;s account (some banks require it, some reject it)
          </label>
          <SubmitButton pendingLabel="Saving…" className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep sm:col-span-2">
            Save bank file settings
          </SubmitButton>
        </form>
        <SettingRow
          title="Email a remittance advice when a payee is paid"
          description="Lists what the transfer covered. Goes to the payee's remittance email (set on the vendor's payment details), or to a member's own address when they are reimbursed."
          on={settings.remittance_emails}
          action={setRemittanceEmails}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Budgets</h2>
        <form action={setBudgetAlerts} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <label className="flex items-center gap-2 font-medium text-ink">
              <input type="checkbox" name="enabled" defaultChecked={settings.budget_alerts.enabled} />
              Alert whoever sets budgets as a category passes
            </label>
            <p className="mt-0.5 text-xs text-ink/60">
              Of its budget for the Hijri year, once each. For other alerts, build one on Announcements &amp; alerts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input name="percents" defaultValue={settings.budget_alerts.percents.join(", ")} className="input w-28" aria-label="Percentages" />
            <span className="text-xs text-ink/55">%</span>
            <SubmitButton pendingLabel="Saving…" className="rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30">
              Save
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Reminders</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            Once a day at 8am Sydney time, anyone with something waiting longer than the first limit gets one summary.
            Past the second limit, the person&apos;s stand-in is told, or the team chosen below if nobody is standing in.
            {lastRun?.last_run_at ? ` Last ran ${formatDateTime(lastRun.last_run_at as string)}.` : " Hasn't run yet."}
          </p>
        </div>
        <form action={setReminders} className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white/60 px-4 py-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="enabled" defaultChecked={r.enabled} />
            Send reminders
          </label>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-ink/55">
                <tr>
                  <th scope="col" className="py-1.5 pr-4 font-medium">What&apos;s waiting</th>
                  <th scope="col" className="py-1.5 pr-4 font-medium">First reminder after</th>
                  <th scope="col" className="py-1.5 pr-4 font-medium">Escalate after</th>
                  <th scope="col" className="py-1.5 font-medium">Escalate to, if nobody is standing in</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["approvals", "Expenses to approve"],
                    ["payments", "Approved, not yet paid"],
                    ["bankAccounts", "Bank accounts not confirmed"],
                  ] as const
                ).map(([key, label]) => (
                  <tr key={key} className="border-t border-ink/5">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{label}</th>
                    <td className="py-2 pr-4">
                      <input type="number" min={0} max={365} name={`${key}_first`} defaultValue={r[key].firstAfterDays} className="input w-20 py-1" aria-label={`${label}: first reminder after days`} /> days
                    </td>
                    <td className="py-2 pr-4">
                      <input type="number" min={0} max={365} name={`${key}_escalate`} defaultValue={r[key].escalateAfterDays} className="input w-20 py-1" aria-label={`${label}: escalate after days`} /> days
                    </td>
                    <td className="py-2">
                      <select name={`${key}_team`} defaultValue={r[key].escalateTeamId ?? ""} className="input py-1" aria-label={`${label}: escalate to team`}>
                        <option value="">Nobody</option>
                        {(teams ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <label className="flex items-center gap-2">
              Remind a submitter once, if a declined expense isn&apos;t resubmitted after
              <input type="number" min={0} max={365} name="declined" defaultValue={r.declinedAfterDays} className="input w-20 py-1" />
              days
            </label>
            <label className="flex items-center gap-2">
              New vendors, items and packs: weekly, on
              <select name="weekday" defaultValue={r.masterDataWeekday} className="input py-1">
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <SubmitButton pendingLabel="Saving…" className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep">
            Save reminders
          </SubmitButton>
        </form>
      </section>

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
        <div>
          <h2 className="section-title text-ink">Receipt reading check</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            Receipts whose correct values have been confirmed are read again on a schedule, a few each morning, and
            admins are told if fewer values come out right than last time — the usual cause is a change of AI model.{" "}
            {checkReceiptCount
              ? `${checkReceiptCount} confirmed ${checkReceiptCount === 1 ? "receipt" : "receipts"} loaded.`
              : "No confirmed receipts are loaded yet: run scripts/load-extraction-check.mjs with the receipts folder."}
          </p>
        </div>
        <form action={setExtractionCheck} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-3 text-sm">
          <label className="flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" name="enabled" defaultChecked={ec.enabled} />
            Check how well receipts are read
          </label>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2">
              Every
              <input type="number" min={1} max={365} name="every_days" defaultValue={ec.everyDays} className="input w-20 py-1" />
              days
            </label>
            <label className="flex items-center gap-2">
              Reading
              <input type="number" min={1} max={20} name="per_morning" defaultValue={ec.perMorning} className="input w-16 py-1" />
              a morning
            </label>
            <label className="flex items-center gap-2">
              Tell admins when it drops more than
              <input type="number" min={1} max={100} name="drop_points" defaultValue={ec.alertDropPoints} className="input w-16 py-1" />
              points
            </label>
          </div>
          <SubmitButton pendingLabel="Saving…" className="self-start rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30">
            Save
          </SubmitButton>
        </form>
        {(checkRuns ?? []).length > 0 && (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(checkRuns ?? []).map((run) => {
              const read = ((run.extraction_benchmark_results as { case_id: string }[] | null) ?? []).length;
              const pct = accuracy({ checks: Number(run.checks), passed: Number(run.passed) });
              return (
                <li key={run.id as string} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2">
                  <span className="text-ink">
                    {formatDateTime(run.started_at as string)} <span className="text-xs text-ink/50">· {run.model as string}</span>
                  </span>
                  <span className="text-xs text-ink/65">
                    {run.finished_at
                      ? `${pct ?? "—"}% of ${run.checks} checked values right${Number(run.failed_cases) ? ` · ${run.failed_cases} couldn't be read` : ""}`
                      : `Under way: ${read} of ${run.case_count} read`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!!checkReceiptCount && (
          <form action={runExtractionCheckNow}>
            <SubmitButton pendingLabel="Starting…" className="text-xs text-ink/60 underline hover:text-ink">
              {(checkRuns ?? []).some((run) => !run.finished_at) ? "Read the next few now" : "Start a check now"}
            </SubmitButton>
          </form>
        )}
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
