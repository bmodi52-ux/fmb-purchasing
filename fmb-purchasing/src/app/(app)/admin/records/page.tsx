import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { todayIso } from "@/lib/periods-data";
import { loadRecordsState, recordsAttention } from "@/lib/records";
import { recordRestoreRehearsal } from "./actions";

export const metadata = { title: "Backups & records" };

const WHAT_LABELS: Record<string, string> = {
  database: "The database",
  receipt_files: "Receipt files",
  both: "The database and receipt files",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Whether FMB could get its records back (#45): when each kind of backup last
 * ran, when a restore was last rehearsed, and how long receipts are kept.
 */
export default async function RecordsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");

  const admin = createAdminClient();
  const [state, { data: runs }, { data: rehearsals }, { count: receiptCount }] = await Promise.all([
    loadRecordsState(admin),
    admin
      .from("backup_runs")
      .select("id, kind, started_at, finished_at, item_count, new_count, bytes, problems, destination")
      .order("finished_at", { ascending: false })
      .limit(10),
    admin
      .from("restore_rehearsals")
      .select("id, rehearsed_on, what, succeeded, notes, recorded_by")
      .order("rehearsed_on", { ascending: false })
      .limit(10),
    admin.from("expense_attachments").select("id", { count: "exact", head: true }),
  ]);
  const due = recordsAttention(state);

  const recorderIds = [...new Set((rehearsals ?? []).map((r) => r.recorded_by as string | null).filter(Boolean) as string[])];
  const { data: recorders } = recorderIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", recorderIds)
    : { data: [] };
  const recorderName = new Map((recorders ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">Backups &amp; records</h1>
        <p className="page-description mt-1 max-w-2xl">
          The ATO expects FMB&apos;s records kept for five years. This is where to check they could be got back: when each
          backup last ran, and when a restore was last tried. How to take and restore them is in
          docs/backup-and-restore.md.
        </p>
      </div>

      {due.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-maroon/25 bg-maroon/5 px-4 py-3 text-sm text-maroon">
          {due.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-palm/25 bg-palm/5 px-4 py-3 text-sm text-palm">
          Backups are current, and a restore has been rehearsed in the last six months.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Backups</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            Supabase&apos;s own backups cover the database but not receipt files. Run{" "}
            <span className="font-mono">node scripts/backup-data.mjs</span> and{" "}
            <span className="font-mono">node scripts/backup-receipts.mjs</span> on a schedule; each run is recorded here.
          </p>
        </div>
        {(runs ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">None recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-ink/55">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Finished</th>
                  <th scope="col" className="px-4 py-2 font-medium">What</th>
                  <th scope="col" className="px-4 py-2 font-medium">Saved</th>
                  <th scope="col" className="px-4 py-2 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => (
                  <tr key={r.id as string} className="border-t border-ink/5">
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTime(r.finished_at as string)}</td>
                    <td className="px-4 py-2">{r.kind === "database" ? "Database" : "Receipt files"}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.kind === "database"
                        ? `${Number(r.item_count).toLocaleString("en-AU")} rows`
                        : `${Number(r.item_count).toLocaleString("en-AU")} files, ${Number(r.new_count).toLocaleString("en-AU")} new · ${formatBytes(Number(r.bytes))}`}
                      {Number(r.problems) > 0 && <span className="ml-2 text-maroon">{r.problems} problems</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink/60">{(r.destination as string | null) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Restore rehearsals</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink/60">
            An untested backup is a belief, not a backup. Restore into a scratch Supabase project, open an expense and its
            receipt, then record it here.
          </p>
        </div>
        {(rehearsals ?? []).length > 0 && (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(rehearsals ?? []).map((r) => (
              <li key={r.id as string} className="flex flex-col gap-0.5 px-4 py-2">
                <p className="text-ink">
                  {formatPlainDate(r.rehearsed_on as string)} · {WHAT_LABELS[r.what as string] ?? r.what}{" "}
                  <span className={r.succeeded ? "text-palm" : "text-maroon"}>{r.succeeded ? "restored" : "failed"}</span>
                </p>
                {r.notes && <p className="text-xs text-ink/65">{r.notes as string}</p>}
                <p className="text-xs text-ink/45">
                  Recorded by {r.recorded_by ? (recorderName.get(r.recorded_by as string) ?? "someone no longer here") : "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={recordRestoreRehearsal} className="grid gap-3 rounded-lg border border-ink/10 bg-white/60 px-4 py-4 text-sm sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Rehearsed on</span>
            <input type="date" name="rehearsed_on" required defaultValue={todayIso()} className="input text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">What was restored</span>
            <select name="what" defaultValue="both" className="input text-sm">
              {Object.entries(WHAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1 text-xs">
            <legend className="mb-1 text-ink/55">Did it work?</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="succeeded" value="yes" defaultChecked /> Yes
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="succeeded" value="no" /> No
              </label>
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-xs sm:col-span-3">
            <span className="text-ink/55">Notes</span>
            <textarea name="notes" rows={2} placeholder="Which backup, what was checked, anything that went wrong" className="input text-sm" />
          </label>
          <SubmitButton pendingLabel="Recording…" className="self-start rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep">
            Record rehearsal
          </SubmitButton>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="section-title text-ink">Keeping receipts</h2>
        <p className="max-w-2xl text-sm text-ink/70">
          {(receiptCount ?? 0).toLocaleString("en-AU")} receipt files are attached to expenses. None can be removed for
          five years: once an expense is decided its receipts can&apos;t be taken off it, and an expense with receipts
          can&apos;t be deleted. While an expense is still waiting, its submitter can swap a wrong file for the right one.
        </p>
      </section>
    </div>
  );
}
