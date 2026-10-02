import Link from "next/link";
import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRange } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { loadDashboardNow, loadDashboardRange, type DashboardNow, type DashboardRange, type SpendFigure } from "@/lib/reporting/dashboard-data";
import { favouritesFirst } from "@/lib/reporting/favourites";
import { favouriteReportsOf } from "@/lib/reporting/favourites-data";
import { SECTIONS, buildHref } from "@/lib/reporting/query";
import { RANGE_PRESETS, resolveRange, type RangePreset } from "@/lib/reporting/range-presets";
import { DASHBOARD_KEY, findReport, reportNavFor } from "@/lib/reporting/registry";
import { loadSavedViews, sortViews } from "@/lib/saved-report-views";
import { MeasureKey } from "@/components/measure-key";
import { PeriodPicker } from "@/components/period-picker";
import { ReportTile } from "@/components/report-tile";
import { OverTimeChart, RankedBars, TrendChart } from "./dashboard-charts";
import { FavouriteStar } from "./favourite-star";
import { ReportNav } from "./report-nav";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const plural = (n: number, word: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? word : `${word}s`}`;

const GRAIN_WORD = { day: "by the day", week: "by the week", month: "by the month" } as const;

/** The Spending report on a period, at one of its sections: where each chart's link leads. */
const spendingHref = (periodCode: string, patch: Parameters<typeof buildHref>[1] = {}) =>
  buildHref(
    { period: periodCode, section: "overview", status: "spend", vendors: [], categories: [], items: [], breakdownBy: "category", compareBy: "item" },
    patch
  );

/**
 * The way in to Reports: how things stand today, what a chosen period looks
 * like, and the reports and saved views someone keeps to hand.
 *
 * Nothing here is counted afresh. Each figure is one a report already shows
 * (lib/reporting/dashboard) and links to that report, on the same period, so
 * the dashboard and the reports cannot tell different stories.
 *
 * Laid out for one look: the four figures, then spend over the period with
 * what is waiting to be paid beside it — the two things asked of this page
 * most — then where the spend went, and last the ways out to the reports.
 *
 * Each part loads by itself and takes its place when it is ready, in a card
 * that already has its name, so one slow part does not hold up the rest.
 */
export async function ReportsDashboard({ user, params }: { user: CurrentUser; params: Params }) {
  const today = todayIso();
  const admin = createAdminClient();
  const { preset, period } = resolveRange(params, today);
  const by = one(params.by) === "item" ? "item" : "category";

  const canBudgets = await userCan(user, "budgets", "view");
  // Each started once and read by several parts of the page: the figures
  // along the top and the ageing of what is waiting; the period's chart, its
  // rankings and its split.
  const now = loadDashboardNow(admin, today, canBudgets);
  const range = loadDashboardRange(period, by, today);
  const earliest = earliestExpenseDate(admin);

  const presetHref = (key: RangePreset) => {
    const q = new URLSearchParams({ range: key });
    if (key === "custom") q.set("period", period.code);
    if (by === "item") q.set("by", "item");
    return `/reports?${q}`;
  };
  const byHref = (next: "category" | "item") => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "by" && typeof value === "string") q.set(key, value);
    }
    if (next === "item") q.set("by", "item");
    const qs = q.toString();
    return qs ? `/reports?${qs}` : "/reports";
  };

  const dates = formatRange(period.start, period.end);
  // Keyed by what they show, so choosing another range shows the loading
  // state again rather than the old charts under a new label.
  const shown = `${period.code}:${by}`;

  return (
    <div className="flex flex-col gap-6">
      <ReportNav active={DASHBOARD_KEY} user={user} />
      <div>
        <h1 className="page-title">Reports</h1>
        <MeasureKey measures={["spend", "outstanding", "paid"]} basis="By receipt date · submitted, approved and paid" />
      </div>

      <Suspense fallback={<KpiFallback withBudget={canBudgets} />}>
        <KpiRow now={now} canBudgets={canBudgets} />
      </Suspense>

      <section aria-labelledby="period-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <h2 id="period-heading" className="section-title text-ink">
              Over a period
            </h2>
            <p className="mt-0.5 text-support text-ink/70">
              {period.label}
              {period.label !== dates && ` · ${dates}`}
            </p>
          </div>
          <nav aria-label="Date range" className="segmented flex-wrap">
            {RANGE_PRESETS.map((p) => (
              <Link key={p.key} href={presetHref(p.key)} aria-current={preset === p.key ? "true" : undefined} className="segment py-[0.4rem]">
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        {preset === "custom" && (
          <div className="card p-3">
            <Suspense fallback={<p className="text-body text-ink/60">Loading the period picker…</p>}>
              <CustomPeriod code={period.code} today={today} earliest={earliest} />
            </Suspense>
          </div>
        )}

        {/* On a wide screen the spend and what is owed sit side by side; below that, one over the other. */}
        <div className="grid items-start gap-4 xl:grid-cols-12">
          <Suspense key={`trend:${shown}`} fallback={<CardFallback title="Spend over time" className="xl:col-span-8" tall />}>
            <TrendCard range={range} className="xl:col-span-8" />
          </Suspense>
          <Suspense fallback={<CardFallback title="Awaiting payment" className="xl:col-span-4" />}>
            <AwaitingCard now={now} className="xl:col-span-4" />
          </Suspense>
        </div>

        <Suspense
          key={`top:${shown}`}
          fallback={
            <div className="grid items-start gap-4 md:grid-cols-2">
              <CardFallback title="Top 10 categories" tall />
              <CardFallback title="Top 10 items" tall />
            </div>
          }
        >
          <TopLists range={range} />
        </Suspense>

        <Suspense key={`split:${shown}`} fallback={<CardFallback title={by === "item" ? "Spend by item, over time" : "Spend by category, over time"} tall />}>
          <OverTimeCard range={range} byHref={{ category: byHref("category"), item: byHref("item") }} />
        </Suspense>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Suspense fallback={<CardFallback title="Your reports" className="xl:col-span-8" />}>
          <ReportsCard user={user} className="xl:col-span-8" />
        </Suspense>
        <Suspense fallback={<CardFallback title="Saved views" className="xl:col-span-4" />}>
          <SavedViewsCard user={user} className="xl:col-span-4" />
        </Suspense>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

async function KpiRow({ now, canBudgets }: { now: Promise<DashboardNow>; canBudgets: boolean }) {
  const { month, year, financialYear, overdue, awaiting, budget } = await now;

  return (
    <section aria-label="Today" className={`grid gap-3 sm:grid-cols-2 ${canBudgets ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      <ReportTile label="Spend this month" value={money(month.spend)} href={spendingHref(month.code)}>
        <span>
          {plural(month.expenses, "expense")} · {month.label}
        </span>
        <Change figure={month} />
      </ReportTile>

      <ReportTile label="Spend this year" value={money(year.spend)} href={spendingHref(year.code)}>
        <span>{year.label}</span>
        <Change figure={year} />
        <span>
          {financialYear.label}: {money(financialYear.spend)}
        </span>
      </ReportTile>

      <ReportTile
        label="Overdue payables"
        value={money(overdue.amount)}
        tone={overdue.count > 0 ? "danger" : "normal"}
        dot={overdue.count > 0 ? "alert" : "good"}
        href="/reports/money-out?section=waiting"
      >
        {overdue.count > 0 ? (
          <span>
            <strong>{plural(overdue.count, "expense")}</strong> approved more than {plural(overdue.afterDays, "day")} ago · oldest{" "}
            {plural(overdue.oldestDays ?? 0, "day")}
          </span>
        ) : (
          <span>Nothing approved more than {plural(overdue.afterDays, "day")} ago is unpaid.</span>
        )}
        <span>
          {awaiting.count > 0 ? `${money(awaiting.amount)} awaiting payment in all (${awaiting.count})` : "Nothing is awaiting payment."}
        </span>
      </ReportTile>

      {budget && (
        <ReportTile
          label="Budget used"
          value={budget.used === null ? "No budget" : `${Math.round(budget.used * 100)}%`}
          tone={budget.used === null ? "muted" : budget.used > 1 ? "danger" : "normal"}
          meter={budget.used ?? undefined}
          href={`/budgets?period=${encodeURIComponent(budget.code)}`}
        >
          {budget.used === null ? (
            <span>No budgets are set for {budget.yearLabel}.</span>
          ) : (
            <span>
              <strong>{(budget.remaining ?? 0) < 0 ? `${money(-(budget.remaining ?? 0))} over` : `${money(budget.remaining ?? 0)} left`}</strong> of{" "}
              {money(budget.budgeted)} · {budget.yearLabel}
            </span>
          )}
        </ReportTile>
      )}
    </section>
  );
}

/**
 * The change against the same stretch of the period before. No red or green:
 * spending more is not in itself bad, so direction is an arrow and a name.
 */
function Change({ figure }: { figure: Pick<SpendFigure, "change" | "against"> }) {
  if (figure.change === null) return <span>Nothing in {figure.against} to compare with</span>;
  const up = figure.change > 0;
  return (
    <span>
      <strong>
        <span aria-hidden="true">{up ? "↑" : figure.change < 0 ? "↓" : "→"}</span> {Math.abs(Math.round(figure.change * 100))}%
      </strong>{" "}
      {up ? "more than" : figure.change < 0 ? "less than" : "the same as"} {figure.against}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* A period                                                            */
/* ------------------------------------------------------------------ */

async function CustomPeriod({ code, today, earliest }: { code: string; today: string; earliest: Promise<string | null> }) {
  return <PeriodPicker value={code} today={today} earliest={await earliest} />;
}

async function TrendCard({ range, className }: { range: Promise<DashboardRange>; className: string }) {
  const r = await range;

  if (r.expenses === 0) {
    return (
      <p className={`card px-4 py-8 text-center text-body text-ink/70 ${className}`}>
        Nothing recorded for {r.period.label}. Choose another range above, or{" "}
        <Link href="/submit" className="text-brand underline underline-offset-[3px]">
          submit an expense
        </Link>
        .
      </p>
    );
  }

  return (
    <ChartCard
      className={className}
      title="Spend over time"
      subtitle={`${money(r.spend)} · ${plural(r.expenses, "expense")} · ${GRAIN_WORD[r.trend.grain]}`}
      link={{ href: spendingHref(r.period.code), label: "Open in Spending" }}
    >
      <TrendChart
        points={r.trend.points}
        label={`Spend over ${r.period.label}, ${GRAIN_WORD[r.trend.grain]}`}
        period={r.period.label}
        against={r.against}
      />
      {r.change !== null && (
        <p className="mt-3 text-support text-ink/70 [&_strong]:font-semibold [&_strong]:text-ink">
          <Change figure={r} />
        </p>
      )}
    </ChartCard>
  );
}

/** Where the period's spend went: its ten largest categories and items. Nothing, when nothing was spent. */
async function TopLists({ range }: { range: Promise<DashboardRange> }) {
  const r = await range;
  if (r.expenses === 0) return null;
  const code = r.period.code;

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <ChartCard
        title="Top 10 categories"
        subtitle="By spend, with each one's share of the period"
        link={{ href: spendingHref(code, { section: "breakdown", breakdownBy: "category" }), label: "All categories" }}
      >
        {r.topCategories.length ? <RankedBars data={r.topCategories} total={r.spend} /> : <Empty>No lines have a category in this period.</Empty>}
      </ChartCard>

      <ChartCard
        title="Top 10 items"
        subtitle="By spend, with each one's share of the period"
        link={{ href: spendingHref(code, { section: "breakdown", breakdownBy: "item" }), label: "All items" }}
      >
        {r.topItems.length ? <RankedBars data={r.topItems} total={r.spend} /> : <Empty>No lines are matched to an item in this period.</Empty>}
      </ChartCard>
    </div>
  );
}

async function OverTimeCard({ range, byHref }: { range: Promise<DashboardRange>; byHref: { category: string; item: string } }) {
  const r = await range;
  if (r.expenses === 0) return null;

  return (
    <ChartCard
      title={r.by === "item" ? "Spend by item, over time" : "Spend by category, over time"}
      subtitle="The largest named; the rest together"
      link={{ href: spendingHref(r.period.code, { section: "breakdown", breakdownBy: r.by }), label: "Open Breakdown" }}
      control={
        <div className="segmented" role="group" aria-label="Split by">
          <Link href={byHref.category} aria-current={r.by === "category" ? "true" : undefined} className="segment" scroll={false}>
            Categories
          </Link>
          <Link href={byHref.item} aria-current={r.by === "item" ? "true" : undefined} className="segment" scroll={false}>
            Items
          </Link>
        </div>
      }
    >
      {r.overTime.months.length ? <OverTimeChart months={r.overTime.months} series={r.overTime.series} /> : <Empty>Nothing to split in this period.</Empty>}
    </ChartCard>
  );
}

function ChartCard({
  title,
  subtitle,
  link,
  control,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  control?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card min-w-0 p-[1.1rem] ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-support text-ink/70">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {control}
          {link && (
            <Link href={link.href} className="text-support whitespace-nowrap text-brand underline underline-offset-[3px]">
              {link.label}
            </Link>
          )}
        </div>
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/** Nothing to show, said in a line: a card with nothing in it is no taller than that. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-ink/70">{children}</p>;
}

/** Nothing to show because nothing is wrong. */
function AllClear({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-body text-ink/70">
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-palm/15 text-[0.75rem] text-[#00702f]">
        ✓
      </span>
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* What is waiting                                                     */
/* ------------------------------------------------------------------ */

/** The longer something has waited, the warmer its colour: brand, gold, then the two reds. */
const AGE_COLOURS = ["var(--color-brand)", "var(--color-gold)", "var(--color-alert)", "var(--color-danger)"];

/**
 * Everything approved and not yet paid, by how long it has waited: one bar
 * split by age, the same four ages Money out lists, and what of it is
 * overdue. As of today, whatever period is chosen above — it sits beside the
 * spend because what has been spent and what is still owed are read together.
 */
async function AwaitingCard({ now, className }: { now: Promise<DashboardNow>; className: string }) {
  const { awaiting, overdue } = await now;

  return (
    <ChartCard
      className={className}
      title="Awaiting payment"
      subtitle={awaiting.count > 0 ? `${money(awaiting.amount)} · ${plural(awaiting.count, "expense")} · as of today` : "As of today"}
      link={{ href: "/reports/money-out?section=waiting", label: "Open" }}
    >
      {awaiting.count === 0 ? (
        <AllClear>Nothing is waiting to be paid.</AllClear>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Awaiting payment by age: ${awaiting.bands.map((b) => `${b.label}, ${money(b.amount)}`).join("; ")}`}
            className="flex h-3.5 gap-[2px] overflow-hidden rounded-full"
          >
            {awaiting.bands.map((band, i) =>
              band.amount > 0 ? <span key={band.label} className="min-w-1" style={{ flex: `${band.amount} 1 0`, background: AGE_COLOURS[i] }} /> : null
            )}
          </div>
          <div className="mt-3.5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 gap-y-2 text-body">
            {awaiting.bands.map((band, i) => (
              <div key={band.label} className={`contents ${band.count === 0 ? "text-ink/55" : ""}`}>
                <span className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-sm"
                    style={{ background: band.count > 0 ? AGE_COLOURS[i] : "rgb(43 33 28 / 0.12)" }}
                  />
                  {band.label}
                </span>
                <span className="text-right text-support tabular-nums">{band.count}</span>
                <span className="text-right font-medium tabular-nums">{band.count > 0 ? money(band.amount) : "—"}</span>
              </div>
            ))}
            <div className="contents font-semibold">
              <span className="border-t border-ink/15 pt-2.5">Overdue (more than {plural(overdue.afterDays, "day")})</span>
              <span className="border-t border-ink/15 pt-2.5 text-right text-support tabular-nums">{overdue.count}</span>
              <span className={`border-t border-ink/15 pt-2.5 text-right tabular-nums ${overdue.count > 0 ? "text-danger" : ""}`}>
                {money(overdue.amount)}
              </span>
            </div>
          </div>
        </>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* Kept to hand                                                        */
/* ------------------------------------------------------------------ */

async function ReportsCard({ user, className }: { user: CurrentUser; className: string }) {
  const [links, favourites] = await Promise.all([reportNavFor(user), favouriteReportsOf(user.id)]);
  const reports = favouritesFirst(
    links.filter((l) => l.key !== DASHBOARD_KEY),
    favourites
  );
  const starred = new Set(favourites);

  return (
    <ChartCard className={className} title="Your reports" subtitle={starred.size ? "Your favourites first" : "Star the ones you use most"}>
      <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => {
          const definition = findReport(r.key)!;
          return (
            <li key={r.key} className="relative rounded-lg border border-ink/10 transition-colors hover:border-ink/25">
              <Link href={r.href} className="block h-full px-3.5 py-3 pr-11">
                <span className="block text-body font-semibold text-ink">{r.label}</span>
                <span className="mt-0.5 line-clamp-2 text-support text-ink/70" title={definition.description}>
                  {definition.description}
                </span>
              </Link>
              {/* Beside the link, not inside it: a star is pressed, a report is opened. */}
              <span className="absolute top-1.5 right-1.5">
                <FavouriteStar reportKey={r.key} title={r.label} initial={starred.has(r.key)} />
              </span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

async function SavedViewsCard({ user, className }: { user: CurrentUser; className: string }) {
  const views = sortViews(await loadSavedViews(createAdminClient(), user), user.id);
  const shown = views.slice(0, 8);

  return (
    <ChartCard
      className={className}
      title="Saved views"
      subtitle={views.length ? "Spending, set up the way you saved it" : undefined}
      link={{ href: "/reports/spending", label: views.length > shown.length ? `All ${views.length}` : "Manage" }}
    >
      {views.length === 0 ? (
        <Empty>
          No saved views yet. In{" "}
          <Link href="/reports/spending" className="text-brand underline underline-offset-[3px]">
            Spending
          </Link>
          , set up a report and choose <strong className="font-semibold text-ink">Saved views</strong> to keep it.
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-ink/[0.06]">
          {shown.map((v) => (
            <li key={v.id} className="py-2.5 first:pt-0 last:pb-0">
              <Link href={buildHref(v.query, {})} className="group block">
                <span className="text-body font-medium text-ink underline-offset-[3px] group-hover:underline">{v.name}</span>
                <span className="mt-0.5 block text-support text-ink/70">
                  {SECTIONS.find((s) => s.key === v.query.section)?.label ?? "Overview"}
                  {v.ownerId === user.id ? " · yours" : " · shared with you"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* While it loads                                                      */
/* ------------------------------------------------------------------ */

/**
 * Loading states are the cards themselves, already in place and named, with
 * a quiet word inside — not grey bars, which on a wide screen read as a
 * broken page (see components/page-loading). They render once and keep
 * still.
 */
function KpiFallback({ withBudget }: { withBudget: boolean }) {
  const labels = ["Spend this month", "Spend this year", "Overdue payables", ...(withBudget ? ["Budget used"] : [])];
  return (
    <div role="status" aria-live="polite" className={`grid gap-3 sm:grid-cols-2 ${withBudget ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      {labels.map((label) => (
        <ReportTile key={label} label={label} value="—" tone="muted" hint="Loading…" />
      ))}
    </div>
  );
}

function CardFallback({ title, className = "", tall = false }: { title: string; className?: string; tall?: boolean }) {
  return (
    <section role="status" aria-live="polite" className={`card p-[1.1rem] ${className}`}>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className={`flex items-center text-body text-ink/60 ${tall ? "h-[17rem]" : "h-12"}`}>Loading…</p>
    </section>
  );
}
