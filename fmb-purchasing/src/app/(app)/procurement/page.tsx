import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { SECTIONS, SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";
import { isoDate, rangeFromParams } from "@/lib/buying-week";
import { loadProcurement, type ProcurementLine } from "./data";
import { WeekPicker } from "./week-picker";
import { reassign, setRequirementNote, setRequirementStatus, setRequirementVendor } from "./actions";
import { ProcurementTabs } from "./tabs";
import { dayLabel, orderByDate, urgency } from "@/lib/thaali-buying";

export const metadata = { title: "Procurement" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const STATUS_LABEL: Record<ProcurementLine["status"], string> = {
  to_order: "To order",
  ordered: "Ordered",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * What has to be bought, and how far it has got (#70, piece three).
 *
 * Grouped by day and then by section, because that is how it is bought: one
 * trip for the meat, another for the produce. Each line says what to order —
 * rounded to a pack somebody actually sells — who is buying it, and what has
 * already been spent against it.
 */
export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; who?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "view");
  const permissions = await getUserPermissions(user);
  const canManage = can(permissions, "procurement", "manage");

  const { from: fromParam, to: toParam, who, status: statusParam } = await searchParams;
  const today = isoDate(new Date());
  const { from, to } = rangeFromParams({ from: fromParam, to: toParam }, today);

  // Mine by default: the page is mostly opened by whoever has the buying to
  // do, and "everyone's" is a click away for whoever runs it.
  const onlyMine = who !== "all";
  const admin = createAdminClient();
  const lines = await loadProcurement(admin, { from, to, ownerId: onlyMine ? user.id : null });
  const shown = statusParam === "open" ? lines.filter((l) => l.status !== "delivered") : lines;

  const [{ data: vendors }, { data: people }] = await Promise.all([
    admin.from("vendors").select("id, name, vendor_number").eq("status", "approved").order("name"),
    canManage ? admin.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
  ]);

  // Day → section → lines, which is the order it gets bought in.
  const byDay = new Map<string, ProcurementLine[]>();
  for (const line of shown) {
    const key = `${line.serviceDate}|${line.kitchenName}`;
    byDay.set(key, [...(byDay.get(key) ?? []), line]);
  }

  const href = (next: Record<string, string>) => {
    const params = new URLSearchParams({ from, to, who: onlyMine ? "mine" : "all", ...next });
    if (statusParam) params.set("status", statusParam);
    return `/procurement?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Procurement</h1>
        <p className="page-description mt-1 max-w-2xl">
          What released menus need, by day and section. Quantities come from the menus; what to order is rounded to a
          pack the supplier sells.
        </p>
      </div>

      <ProcurementTabs active="buy" canManage={canManage} />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 text-sm">
        <WeekPicker
          action="/procurement"
          range={{ from, to }}
          today={today}
          hidden={{ who: onlyMine ? "mine" : "all", status: statusParam }}
        />
        <div className="flex items-center gap-2">
          <Link
            href={href({ who: "mine" })}
            className={`rounded-md border px-3 py-2 ${onlyMine ? "border-gold-deep bg-gold/10" : "border-ink/15 text-ink/60"}`}
          >
            Mine
          </Link>
          {canManage && (
            <Link
              href={href({ who: "all" })}
              className={`rounded-md border px-3 py-2 ${!onlyMine ? "border-gold-deep bg-gold/10" : "border-ink/15 text-ink/60"}`}
            >
              Everyone&apos;s
            </Link>
          )}
          <Link
            href={statusParam === "open" ? href({}).replace(/&status=open/, "") : `${href({})}&status=open`}
            className={`rounded-md border px-3 py-2 ${statusParam === "open" ? "border-gold-deep bg-gold/10" : "border-ink/15 text-ink/60"}`}
          >
            Still to buy
          </Link>
        </div>
      </div>

      {byDay.size === 0 ? (
        <p className="text-sm text-ink/55">
          Nothing to buy between these dates.{" "}
          {onlyMine && canManage && <Link href={href({ who: "all" })} className="underline">Try everyone&apos;s.</Link>}
        </p>
      ) : (
        [...byDay.entries()].map(([key, dayLines]) => {
          const [date, kitchen] = key.split("|");
          const planned = dayLines.reduce((sum, l) => sum + (l.plannedCost ?? 0), 0);
          const spent = dayLines.reduce((sum, l) => sum + l.spent, 0);

          return (
            <section key={key} className="card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="section-title text-ink">
                  <Link href={`/menus/${date}`} className="underline-offset-2 hover:underline">
                    {formatPlainDate(date)}
                  </Link>
                  <span className="ml-2 text-sm font-normal text-ink/55">{kitchen}</span>
                </h2>
                <span className="tabular-nums text-sm text-ink/60">
                  planned {money(planned)}
                  {spent > 0 && <span className="ml-2 text-ink/80">· spent {money(spent)}</span>}
                </span>
              </div>

              {SECTIONS.filter((s) => dayLines.some((l) => l.section === s)).map((section) => (
                <div key={section} className="mb-4 last:mb-0">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-medium tracking-wide text-ink/60 uppercase">{SECTION_LABEL[section]}</h3>
                    {canManage && (
                      <form action={reassign} className="flex items-center gap-1 text-xs">
                        <input type="hidden" name="menu_day_id" value={dayLines[0].menuDayId} />
                        <input type="hidden" name="section" value={section} />
                        <FormResetBoundary>
                          <select name="owner_id" defaultValue="" className="input py-0.5 text-xs" aria-label={`Hand ${SECTION_LABEL[section]} to`}>
                            <option value="">— hand this section to —</option>
                            {(people ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name || p.email}
                              </option>
                            ))}
                          </select>
                        </FormResetBoundary>
                        <SubmitButton className="rounded border border-ink/15 px-2 py-0.5 hover:border-ink/30">
                          Move
                        </SubmitButton>
                      </form>
                    )}
                  </div>

                  <ul className="flex flex-col gap-2">
                    {dayLines
                      .filter((l) => l.section === section)
                      .map((line) => (
                        <li
                          key={line.id}
                          className={`rounded-md border p-3 text-sm ${
                            line.status === "delivered" ? "border-palm/30 bg-palm/5" : "border-ink/10 bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <span className="text-ink">
                              {line.itemName}
                              {line.itemNumber && <span className="ml-1.5 tabular-nums text-xs text-ink/40">{line.itemNumber}</span>}
                            </span>
                            <span className="tabular-nums text-ink/80">
                              {line.quantity} {line.unit}
                              {line.pack && line.pack.packs > 0 && (
                                <span className="ml-2 text-ink/55">
                                  = {line.pack.packs} × {line.pack.title}
                                  {line.pack.over > 0 && ` (${line.pack.over} ${line.unit} over)`}
                                </span>
                              )}
                            </span>
                          </div>

                          {/* When it has to be ordered by, and who to ring (#15). */}
                          {(line.status === "to_order" || line.vendorName) && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              {line.status === "to_order" && <OrderBy line={line} today={today} />}
                              {line.vendorName && (
                                <span className="text-ink/60">
                                  {line.vendorName}
                                  {line.vendorPhone && (
                                    <a
                                      href={`tel:${line.vendorPhone.replace(/[^\d+]/g, "")}`}
                                      className="ml-2 inline-block rounded-full border border-ink/15 px-2.5 py-1 text-ink hover:border-ink/30"
                                    >
                                      Call {line.vendorPhone}
                                    </a>
                                  )}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/55">
                            <span className={line.status === "delivered" ? "text-palm" : line.status === "ordered" ? "text-gold-deep" : ""}>
                              {STATUS_LABEL[line.status]}
                            </span>
                            {line.ownerName ? <span>· {line.ownerName}</span> : <span className="text-alert">· nobody yet</span>}
                            {line.plannedCost != null && <span>· planned {money(line.plannedCost)}</span>}
                            {line.bought > 0 && (
                              <span className="text-ink/75">
                                · bought {line.bought} {line.unit} for {money(line.spent)}
                                {line.outstanding > 0 && `, ${line.outstanding} ${line.unit} still to come`}
                              </span>
                            )}
                            {line.note && <span>· {line.note}</span>}
                          </div>

                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            {(["to_order", "ordered", "delivered"] as const)
                              .filter((s) => s !== line.status)
                              .map((s) => (
                                <form key={s} action={setRequirementStatus}>
                                  <input type="hidden" name="requirement_ids" value={line.id} />
                                  <input type="hidden" name="status" value={s} />
                                  {/* The next step is the big one: on a phone in a shop it is
                                      the only button that matters (#15). */}
                                  <SubmitButton
                                    className={
                                      s === NEXT_STEP[line.status]
                                        ? "btn btn-primary btn-lg sm:px-3 sm:py-1 sm:text-xs"
                                        : "btn btn-secondary sm:px-2 sm:py-1 sm:text-xs"
                                    }
                                  >
                                    {s === "to_order" ? "Not ordered" : s === "ordered" ? "Mark ordered" : "Mark delivered"}
                                  </SubmitButton>
                                </form>
                              ))}

                            <form action={setRequirementVendor} className="flex items-end gap-1">
                              <input type="hidden" name="requirement_id" value={line.id} />
                              <FormResetBoundary>
                                <select
                                  key={line.vendorId ?? ""}
                                  name="vendor_id"
                                  defaultValue={line.vendorId ?? ""}
                                  aria-label={`Vendor for ${line.itemName}`}
                                  className="input py-1 text-xs"
                                >
                                  <option value="">— vendor —</option>
                                  {(vendors ?? []).map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.name}
                                    </option>
                                  ))}
                                </select>
                              </FormResetBoundary>
                              <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                                Set
                              </SubmitButton>
                            </form>

                            <form action={setRequirementNote} className="flex items-end gap-1">
                              <input type="hidden" name="requirement_id" value={line.id} />
                              <FormResetBoundary>
                                <input
                                  name="note"
                                  defaultValue={line.note ?? ""}
                                  placeholder="note"
                                  aria-label={`Note for ${line.itemName}`}
                                  className="input py-1 text-xs"
                                />
                              </FormResetBoundary>
                              <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                                Save
                              </SubmitButton>
                            </form>

                            {canManage && (
                              <form action={reassign} className="flex items-end gap-1">
                                <input type="hidden" name="requirement_id" value={line.id} />
                                <FormResetBoundary>
                                  <select
                                    key={line.ownerId ?? ""}
                                    name="owner_id"
                                    defaultValue={line.ownerId ?? ""}
                                    aria-label={`Who buys ${line.itemName}`}
                                    className="input py-1 text-xs"
                                  >
                                    <option value="">— nobody —</option>
                                    {(people ?? []).map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.full_name || p.email}
                                      </option>
                                    ))}
                                  </select>
                                </FormResetBoundary>
                                <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                                  Assign
                                </SubmitButton>
                              </form>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

const NEXT_STEP: Record<ProcurementLine["status"], ProcurementLine["status"] | null> = {
  to_order: "ordered",
  ordered: "delivered",
  delivered: null,
  cancelled: null,
};

/** "Order by Wed 30 Sep", said more loudly the closer it gets (#15). */
function OrderBy({ line, today }: { line: ProcurementLine; today: string }) {
  const by = orderByDate(line.serviceDate, line.leadDays);
  const how = urgency(line, today);
  if (how === "late") return <span className="font-medium text-alert">Should have been ordered by {dayLabel(by)}</span>;
  if (how === "today") return <span className="font-medium text-gold-deep">Order today</span>;
  return <span className={how === "soon" ? "text-ink/80" : "text-ink/55"}>Order by {dayLabel(by)}</span>;
}

export type { SectionKey };
