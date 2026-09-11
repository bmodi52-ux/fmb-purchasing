import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { currentFiscalYearHijri, formatFiscalYear, ALL_YEARS } from "@/lib/fiscal-year";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { FiscalYearSelect } from "@/components/fiscal-year-select";
import { categoryLabelsById } from "@/lib/categories";
import { ExpensesTable, type ExpenseRow } from "./expenses-table";
import { LinesTable, type LineRow } from "./lines-table";
import { ViewToggle } from "./view-toggle";

export const metadata = { title: "All expenses" };

const PAGE_KEY = "all_expenses";
const DEFAULT_VISIBLE = [
  "expense_number",
  "vendor",
  "submitted_by",
  "status",
  "invoice_number",
  "receipt",
  "total",
  "created_at",
];

/**
 * Backstop for "All years", which is the one selection with no natural
 * bound. Everything on this page — filtering, sorting, export — happens in
 * the browser, so the row count is also the size of the payload sent to it.
 */
const ALL_YEARS_CAP = 2000;

const LINES_PAGE_KEY = "expense_lines";
const LINES_DEFAULT_VISIBLE = [
  "expense_number",
  "receipt_date",
  "vendor",
  "kind",
  "description",
  "category",
  "quantity",
  "line_gst",
  "line_total",
];

/**
 * The ledger's own bound.
 *
 * One expense runs five to twenty lines, so a fiscal year is a few thousand of
 * them rather than a few hundred — and this page filters, sorts and exports in
 * the browser, which makes the row count also the size of the payload. Set
 * well above a normal year so the cap is a backstop rather than something
 * anyone meets.
 */
const LINES_CAP = 8000;

export default async function AllExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; view?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "all_expenses", "view");

  const { fy, view } = await searchParams;
  const linesView = view === "lines";
  const currentFy = currentFiscalYearHijri();
  // Defaults to the current year rather than everything ever recorded: an
  // accounting page is almost always asked about a period, and it means the
  // query is bounded by an indexed column instead of growing without limit.
  const showAllYears = fy === ALL_YEARS;
  const selectedFy = showAllYears ? ALL_YEARS : fy ? Number(fy) : currentFy;

  const admin = createAdminClient();

  let query = admin
    .from("expenses")
    .select(
      "id, expense_number, vendor_id, vendor_name_raw, submitted_by, status, invoice_number, receipt_date, subtotal, gst_amount, total, fiscal_year_hijri, decided_by, decided_at, payment_reference, payment_date, created_at",
      { count: "exact" }
    )
    // Withdrawn submissions were taken back before anyone decided them (0044);
    // they stay on the submitter's own list and are not part of the ledger.
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false });

  if (showAllYears) query = query.range(0, ALL_YEARS_CAP - 1);
  else query = query.eq("fiscal_year_hijri", selectedFy as number);

  const [{ data: expenses, count }, { data: fyRows }] = await Promise.all([
    query,
    admin.from("expense_fiscal_years").select("fiscal_year_hijri"),
  ]);

  const fiscalYears = [...new Set((fyRows ?? []).map((r) => r.fiscal_year_hijri))].sort((a, b) => b - a);
  if (!fiscalYears.includes(currentFy)) fiscalYears.unshift(currentFy);

  const userIds = [
    ...new Set((expenses ?? []).flatMap((e) => [e.submitted_by, e.decided_by].filter(Boolean) as string[])),
  ];
  const vendorIds = [...new Set((expenses ?? []).map((e) => e.vendor_id).filter(Boolean) as string[])];

  const [{ data: profiles }, { data: vendors }, visibleColumns] = await Promise.all([
    userIds.length ? admin.from("profiles").select("id, full_name, email").in("id", userIds) : { data: [] },
    vendorIds.length ? admin.from("vendors").select("id, vendor_number").in("id", vendorIds) : { data: [] },
    getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const vendorNumberById = new Map((vendors ?? []).map((v) => [v.id, v.vendor_number]));

  // One query for the whole page rather than one per row: the list only
  // needs to know whether to offer a link.
  const withFiles = await expenseIdsWithAttachments(admin, (expenses ?? []).map((e) => e.id));
  const rows: ExpenseRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    expenseNumber: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    vendorNumber: e.vendor_id ? (vendorNumberById.get(e.vendor_id) ?? null) : null,
    submittedByName: nameById.get(e.submitted_by) ?? "—",
    status: e.status,
    invoice_number: e.invoice_number,
    receipt_date: e.receipt_date,
    hasReceipt: withFiles.has(e.id),
    subtotal: e.subtotal,
    gst_amount: e.gst_amount,
    total: e.total,
    fiscal_year_hijri: e.fiscal_year_hijri,
    decidedByName: e.decided_by ? (nameById.get(e.decided_by) ?? null) : null,
    decided_at: e.decided_at,
    payment_reference: e.payment_reference,
    payment_date: e.payment_date,
    created_at: e.created_at,
  }));

  const truncated = showAllYears && (count ?? 0) > rows.length;

  // Only for the ledger view, and only for the expenses already loaded — so
  // the two views always describe the same set of receipts, and switching
  // between them cannot appear to change what happened in the period.
  const lines = linesView
    ? await loadLines(
        admin,
        rows.map((r) => r.id),
        new Map(rows.map((r) => [r.id, r]))
      )
    : null;
  const linesVisible = linesView
    ? await getColumnPreference(user.id, LINES_PAGE_KEY, LINES_DEFAULT_VISIBLE)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title text-ink">All expenses</h1>
          <p className="page-description mt-1">
            {linesView
              ? "Every line item across these expenses — what was bought, at what price, under which category."
              : showAllYears
                ? "Every expense across FMB, with status, vendor, amounts and GST breakdown."
                : `Expenses filed under ${formatFiscalYear(selectedFy as number)}, with status, vendor, amounts and GST breakdown.`}
          </p>
          <div className="mt-3">
            <ViewToggle linesView={linesView} />
          </div>
        </div>

        <FiscalYearSelect
          fiscalYears={fiscalYears}
          selectedFy={selectedFy}
          currentFy={currentFy}
          allowAllYears
        />
      </div>

      {truncated && (
        <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-ink/80">
          Showing the {ALL_YEARS_CAP.toLocaleString()} most recent of {count?.toLocaleString()} expenses.
          Pick a fiscal year to see a complete set.
        </p>
      )}

      {lines ? (
        <LinesTable rows={lines} initialVisible={linesVisible} />
      ) : (
        <ExpensesTable rows={rows} initialVisible={visibleColumns} />
      )}
    </div>
  );
}

/**
 * The line items behind a set of expenses, flattened for the ledger.
 *
 * Requested in chunks because PostgREST puts the id list in the URL, and a
 * fiscal year of expenses is more ids than a URL will carry. Chunking here
 * rather than paginating keeps the ledger a complete picture of whatever
 * period the page is showing, which is the property that makes it
 * reconcilable.
 */
async function loadLines(
  admin: ReturnType<typeof createAdminClient>,
  expenseIds: string[],
  expensesById: Map<string, ExpenseRow>
): Promise<LineRow[]> {
  if (expenseIds.length === 0) return [];

  const CHUNK = 200;
  const collected: Record<string, unknown>[] = [];

  for (let i = 0; i < expenseIds.length && collected.length < LINES_CAP; i += CHUNK) {
    const { data } = await admin
      .from("expense_line_items")
      .select(
        "id, expense_id, kind, description_raw, category_id, quantity, unit_price, " +
          "line_subtotal, line_gst, line_total, sort_order, " +
          "pricelist_items ( item_pack_sizes ( items ( name ) ) )"
      )
      .in("expense_id", expenseIds.slice(i, i + CHUNK))
      .order("expense_id")
      .order("sort_order")
      .limit(LINES_CAP);
    collected.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }

  const { data: categories } = await admin
    .from("categories")
    .select("id, name, parent_category_id");
  const categoryName = categoryLabelsById(categories ?? []);

  return collected.slice(0, LINES_CAP).map((row) => {
    const expense = expensesById.get(row.expense_id as string);
    const offer = row.pricelist_items as
      | { item_pack_sizes: { items: { name: string } | null } | null }
      | null;
    return {
      id: row.id as string,
      expenseId: row.expense_id as string,
      expenseNumber: expense?.expenseNumber ?? null,
      vendorName: expense?.vendor_name_raw ?? "—",
      receiptDate: expense?.receipt_date ?? null,
      status: expense?.status ?? "",
      submittedByName: expense?.submittedByName ?? "—",
      kind: row.kind as LineRow["kind"],
      description: (row.description_raw as string) ?? "",
      itemName: offer?.item_pack_sizes?.items?.name ?? null,
      categoryName: row.category_id
        ? (categoryName.get(row.category_id as string) ?? "—")
        : "—",
      quantity: row.quantity == null ? null : Number(row.quantity),
      unitPrice: row.unit_price == null ? null : Number(row.unit_price),
      lineSubtotal: Number(row.line_subtotal ?? 0),
      lineGst: Number(row.line_gst ?? 0),
      lineTotal: Number(row.line_total ?? 0),
    };
  });
}
