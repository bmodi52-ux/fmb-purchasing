import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { parsePeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { loadAccountingPeriod, type Basis } from "@/lib/accounting-data";
import { summariseGst } from "@/lib/gst-summary";
import { PeriodPicker } from "@/components/period-picker";
import { SubmitButton } from "@/components/submit-button";
import { lockPeriod, setCategoryAccountCode, unlockPeriod } from "./actions";
import { XeroExportButton } from "./xero-export-button";
import { AutosaveInput } from "@/components/autosave-input";

export const metadata = { title: "Accounting" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * GST, Xero and lodged periods (scratchpad #38).
 *
 * Opens on the current Australian financial year, which is what the GST
 * return runs on, and works for any period. The figures are laid out like the
 * return; the tax points behind them are worth confirming with FMB's
 * accountant before they are copied onto one.
 */
export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; basis?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const params = await searchParams;
  const today = todayIso();
  const period = parsePeriod(params.period ?? "au-current", today);
  const basis: Basis = params.basis === "paid" ? "paid" : "receipt";

  const admin = createAdminClient();
  const [{ gstExpenses, gstLines }, earliest, { data: categoryRows }, { data: locks }] = await Promise.all([
    loadAccountingPeriod(admin, period, basis),
    earliestExpenseDate(admin),
    admin.from("categories").select("id, name, parent_category_id, account_code").order("sort_order"),
    admin.from("locked_periods").select("id, label, start_date, end_date, note, locked_by, locked_at, unlocked_at").order("start_date", { ascending: false }),
  ]);

  const gst = summariseGst(gstExpenses, gstLines);
  const labels = categoryLabelsById(categoryRows ?? []);
  const leaves = leafCategories(sortCategories(categoryRows ?? []));
  const alreadyLocked = (locks ?? []).some((l) => !l.unlocked_at && l.start_date === period.start && l.end_date === period.end);
  const basisHref = (b: Basis) => `/accounting?period=${period.code}&basis=${b}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="page-title text-ink">Accounting</h1>
          <p className="page-description mt-1 max-w-2xl">
            GST for the return, the Xero bills file, account codes, and periods whose return has been lodged. Opens on
            the current financial year.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <PeriodPicker value={period.code} today={today} earliest={earliest} />
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-ink/55">Count expenses by</span>
            <div className="inline-flex rounded-md border border-ink/15 p-0.5">
              {(
                [
                  ["receipt", "Receipt date (approved and paid)"],
                  ["paid", "Payment date (paid)"],
                ] as const
              ).map(([b, label]) => (
                <Link
                  key={b}
                  href={basisHref(b)}
                  aria-current={basis === b ? "true" : undefined}
                  className={`rounded px-3 py-1 ${basis === b ? "bg-gold/20 font-medium text-ink" : "text-ink/60 hover:text-ink"}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">GST for {period.label}</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="G11 · Other purchases" value={money(gst.g11)} hint="GST included" />
          <Tile label="G10 · Capital purchases" value={money(gst.g10)} hint="GST included" />
          <Tile label="1B · GST on purchases" value={money(gst.oneB)} hint={`${gst.expenseCount} expenses`} />
          <Tile label="GST-free purchases" value={money(gst.gstFreePurchases)} hint="Within G10 and G11" />
        </dl>
        {gst.apportionedLines > 0 && (
          <p className="text-xs text-ink/55">
            {gst.apportionedLines} older {gst.apportionedLines === 1 ? "line has" : "lines have"} GST shared out across the
            receipt rather than read per line, so the capital and other split is estimated for those.
          </p>
        )}

        {gst.concerns.length > 0 && (
          <div className="rounded-lg border border-maroon/25 bg-maroon/5 p-4">
            <p className="text-sm font-medium text-maroon">
              GST that may not be claimable ({gst.concerns.length} {gst.concerns.length === 1 ? "expense" : "expenses"})
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {gst.concerns.map(({ expense, reasons }) => (
                <li key={expense.id}>
                  <Link href={`/expenses/${expense.id}`} className="font-mono text-xs underline">
                    {expense.expenseNumber ?? "Expense"}
                  </Link>{" "}
                  {expense.vendorName} · GST {money(expense.gst)} — {reasons.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {gst.adjustments.length > 0 && (
          <div className="rounded-lg border border-gold/40 bg-gold/5 p-4">
            <p className="text-sm font-medium text-ink">Adjustments: approved after their period was lodged</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {gst.adjustments.map((e) => (
                <li key={e.id}>
                  <Link href={`/expenses/${e.id}`} className="font-mono text-xs underline">
                    {e.expenseNumber ?? "Expense"}
                  </Link>{" "}
                  {e.vendorName} · {money(e.total)} · GST {money(e.gst)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Xero</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-ink/60">
            A bills file for Xero&apos;s purchases import: one draft bill per expense in this period, one line per line
            item, with each category&apos;s account code and a tax type from the line&apos;s own GST and capital flags. A
            live connection to Xero is planned once how purchases reach Xero today is confirmed.
          </p>
        </div>
        <XeroExportButton period={period.code} basis={basis} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Account codes</h2>
          <p className="mt-0.5 text-xs text-ink/60">The account in FMB&apos;s chart of accounts each category&apos;s spend goes to. Saved when you leave the field.</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
          <table className="min-w-full text-sm">
            <tbody>
              {leaves.map((c) => (
                <tr key={c.id} className="border-b border-ink/5 last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal">{labels.get(c.id) ?? c.name}</th>
                  <td className="px-4 py-2 text-right">
                    <form action={setCategoryAccountCode} className="flex justify-end">
                      <input type="hidden" name="category_id" value={c.id} />
                      <AutosaveInput
                        name="account_code"
                        defaultValue={((categoryRows ?? []).find((r) => r.id === c.id)?.account_code as string | null) ?? ""}
                        placeholder="e.g. 400"
                        aria-label={`Account code for ${labels.get(c.id) ?? c.name}`}
                        className="input w-28 py-1 text-right font-mono"
                      />
                      <SubmitButton className="sr-only">Save</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">Lodged periods</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-ink/60">
            Lock a period once its GST return is lodged. Decisions and payments dated inside it can no longer be undone,
            and its lines can&apos;t be reclassified. A late receipt dated inside it can still be submitted and paid — it
            shows here as an adjustment for the next return.
          </p>
        </div>
        {!alreadyLocked && (
          <form action={lockPeriod} className="flex flex-wrap items-end gap-2 rounded-lg border border-ink/10 bg-white/60 p-3 text-sm">
            <input type="hidden" name="period" value={period.code} />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/55">Note (optional)</span>
              <input name="note" placeholder="Lodged 28 July" className="input w-56 text-sm" />
            </label>
            <SubmitButton pendingLabel="Locking…" className="rounded-md border border-maroon/40 px-3.5 py-2 text-sm font-medium text-maroon hover:bg-maroon/5">
              Lock {period.label}
            </SubmitButton>
          </form>
        )}
        {(locks ?? []).length > 0 && (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(locks ?? []).map((l) => (
              <li key={l.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className={l.unlocked_at ? "text-ink/45 line-through" : "text-ink"}>
                  {l.label}
                  {l.note ? ` · ${l.note}` : ""}
                  <span className="ml-2 text-xs text-ink/50">locked {formatDateTime(l.locked_at as string)}</span>
                </span>
                {!l.unlocked_at && (
                  <form action={unlockPeriod}>
                    <input type="hidden" name="lock_id" value={l.id} />
                    <SubmitButton className="text-xs text-ink/55 underline hover:text-ink">Unlock</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 p-4">
      <dt className="text-xs text-ink/55">{label}</dt>
      <dd className="mt-0.5 font-mono text-xl font-semibold text-ink">{value}</dd>
      <dd className="text-xs text-ink/45">{hint}</dd>
    </div>
  );
}
