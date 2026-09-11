import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalsList, type ApprovalRow } from "./approvals-list";
import { categoryLabelsById } from "@/lib/categories";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { paymentInstructions } from "@/lib/payment-instruction";
import { getSetting } from "@/lib/app-settings";
import { possibleDuplicates, type DuplicateMatch } from "@/lib/duplicates";
import { GST_CONCERN_LABEL, gstConcerns } from "@/lib/vendor-registration";
import { storedGstDisagreement } from "@/lib/expense-money";
import { mayLackTaxInvoice } from "@/lib/gst-summary";
import { parsePeriod, periodCode, yearContaining } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { budgetsForPeriod, loadBudgets } from "@/lib/budgets";
import { loadReportRawData, withinRange } from "../reports/data";
import { loadPriceFlags, loadSpendFlags } from "@/lib/price-alerts-data";
import { describePriceFlag, describeUnusualSpend, isSeriousPriceFlag } from "@/lib/price-alerts";

type VendorFlagRow = {
  id: string;
  status: string;
  gst_registered: boolean | null;
  abn_active: boolean | null;
  abn: string | null;
};

export const metadata = { title: "Approvals" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** "today", "1 day", "5 days" — how long the oldest submission has waited. */
function waitingFor(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days < 1) return "since today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const admin = createAdminClient();
  const [{ data: expenses }, permissions] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, expense_number, vendor_id, vendor_name_raw, invoice_number, receipt_date, subtotal, gst_amount, gst_printed, total, submitted_by, submitter_comment, payee_id, created_at"
      )
      .eq("status", "submitted")
      .order("created_at"),
    getUserPermissions(user),
  ]);

  if (!expenses || expenses.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="text-sm text-ink/50">Nothing waiting for review.</p>
      </div>
    );
  }

  const submitterIds = [...new Set(expenses.map((e) => e.submitted_by))];
  const expenseIds = expenses.map((e) => e.id);
  const vendorIds = [...new Set(expenses.map((e) => e.vendor_id).filter(Boolean))] as string[];

  const [
    { data: profiles },
    { data: lineItems },
    { data: categories },
    { data: vendors },
    instructions,
    withFiles,
    duplicates,
    [priceFlags, spendFlags],
  ] = await Promise.all([
      admin.from("profiles").select("id, full_name, email").in("id", submitterIds),
      admin
        .from("expense_line_items")
        .select("expense_id, description_raw, quantity, unit_price, line_total, gst_applicable, category_id, pricelist_item_id")
        .in("expense_id", expenseIds)
        .order("sort_order"),
      admin.from("categories").select("id, name, parent_category_id"),
      vendorIds.length
        ? admin.from("vendors").select("id, status, gst_registered, abn_active, abn").in("id", vendorIds)
        : Promise.resolve({ data: [] as VendorFlagRow[] }),
      // Whether each payee's account has been confirmed — the same check the
      // Payments run makes, asked here so it can be noticed before approving.
      paymentInstructions(admin, expenses, { canSeeBankDetails: can(permissions, "payments", "mark_paid") }),
      // One query for the whole page rather than one per row.
      expenseIdsWithAttachments(admin, expenseIds),
      // The warning the submitter already saw, and could ignore — shown to the
      // person who can actually stop a double payment. Switchable (#21).
      getSetting(admin, "duplicate_flags_for_reviewers").then((on) =>
        on ? possibleDuplicates(admin, expenses) : new Map<string, DuplicateMatch[]>()
      ),
      // Prices that moved past their limit, and spend well above the vendor's
      // usual (#29, #42) — both empty when price alerts are switched off.
      getSetting(admin, "price_alerts").then((settings) =>
        Promise.all([loadPriceFlags(admin, expenseIds, settings), loadSpendFlags(admin, expenses, settings)])
      ),
    ]);

  // Lines whose Pricelist item was created by this receipt and nobody has
  // reviewed yet — approving the expense is a good moment to notice them.
  const offerIds = [...new Set((lineItems ?? []).map((l) => l.pricelist_item_id).filter(Boolean))] as string[];
  const { data: offers } = offerIds.length
    ? await admin.from("pricelist_items").select("id, item_pack_sizes ( items ( status ) )").in("id", offerIds)
    : { data: [] };
  const newItemOfferIds = new Set(
    (offers ?? [])
      .filter(
        (o) =>
          (o.item_pack_sizes as unknown as { items: { status: string } | null } | null)?.items?.status === "pending"
      )
      .map((o) => o.id as string)
  );

  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const vendorRows = (vendors ?? []) as VendorFlagRow[];
  const pendingVendorIds = new Set(vendorRows.filter((v) => v.status === "pending").map((v) => v.id));
  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

  const itemsByExpense = new Map<string, NonNullable<typeof lineItems>>();
  for (const li of lineItems ?? []) {
    const list = itemsByExpense.get(li.expense_id) ?? [];
    list.push(li);
    itemsByExpense.set(li.expense_id, list);
  }

  // Where each expense leaves its categories' budgets for the Hijri year it
  // falls in (#39): "Meat: 82% used, this takes it to 86%". Spend already
  // includes expenses waiting for approval, this one among them.
  const today = todayIso();
  const periodOf = (e: (typeof expenses)[number]) =>
    parsePeriod(periodCode("hijri", yearContaining("hijri", e.receipt_date ?? e.created_at.slice(0, 10))), today);
  const budgetCategoryIds = [...new Set((lineItems ?? []).map((l) => l.category_id).filter(Boolean) as string[])];
  const budgets = budgetCategoryIds.length ? await loadBudgets(admin, budgetCategoryIds) : [];
  const spendByPeriod = new Map<string, Map<string, number>>();
  if (budgets.length) {
    for (const code of [...new Set(expenses.map((e) => periodOf(e).code))]) {
      const period = parsePeriod(code, today);
      const raw = withinRange(await loadReportRawData(period), period);
      const spend = new Map<string, number>();
      for (const l of raw.allLines) if (l.categoryId) spend.set(l.categoryId, (spend.get(l.categoryId) ?? 0) + l.lineTotal);
      spendByPeriod.set(code, spend);
    }
  }
  const budgetNotesFor = (e: (typeof expenses)[number], lines: NonNullable<typeof lineItems>) => {
    if (!budgets.length) return [];
    const period = periodOf(e);
    const perCategory = budgetsForPeriod(budgets, period.start, period.end);
    const mine = new Map<string, number>();
    for (const l of lines) if (l.category_id) mine.set(l.category_id, (mine.get(l.category_id) ?? 0) + Number(l.line_total));
    return [...mine.entries()].flatMap(([categoryId, amount]) => {
      const budget = perCategory.get(categoryId);
      if (!budget || budget.amount <= 0) return [];
      const spent = spendByPeriod.get(period.code)?.get(categoryId) ?? amount;
      const after = spent / budget.amount;
      const before = Math.max(0, spent - amount) / budget.amount;
      return [
        {
          text: `${categoryNameById.get(categoryId) ?? "Category"}: ${Math.round(before * 100)}% of its budget used, this takes it to ${Math.round(after * 100)}%`,
          over: after > 1,
        },
      ];
    });
  };

  const rows: ApprovalRow[] = expenses.map((e) => {
    const lines = itemsByExpense.get(e.id) ?? [];
    return {
      budgetNotes: budgetNotesFor(e, lines),
      id: e.id,
      expense_number: e.expense_number,
      vendor_name_raw: e.vendor_name_raw,
      invoice_number: e.invoice_number,
      receipt_date: e.receipt_date,
      subtotal: e.subtotal,
      gst_amount: e.gst_amount,
      total: e.total,
      submittedByName: submitterNameById.get(e.submitted_by) ?? "—",
      created_at: e.created_at,
      hasReceipt: withFiles.has(e.id),
      submitterComment: e.submitter_comment,
      flags: {
        newVendor: e.vendor_id ? pendingVendorIds.has(e.vendor_id) : false,
        unconfirmedAccount: instructions.get(e.id)?.status === "pending",
        newItems: lines.filter((l) => l.pricelist_item_id && newItemOfferIds.has(l.pricelist_item_id)).length,
        duplicateOf: duplicates.get(e.id) ?? [],
        prices: (priceFlags.get(e.id) ?? []).map((f) => ({ label: describePriceFlag(f), serious: isSeriousPriceFlag(f) })),
        unusualSpend: spendFlags.has(e.id) ? describeUnusualSpend(spendFlags.get(e.id)!) : null,
        gstConcerns: [
          ...gstConcerns(e.vendor_id ? (vendorById.get(e.vendor_id) ?? null) : null, Number(e.gst_amount)).map(
            (c) => GST_CONCERN_LABEL[c]
          ),
          // The line GST against the figure printed on the receipt (0048).
          ...(() => {
            const printed = e.gst_printed == null ? null : Number(e.gst_printed);
            const off = storedGstDisagreement(
              Number(e.gst_amount),
              printed,
              lines.filter((l) => l.gst_applicable).length
            );
            return off === null ? [] : [`Line GST ${money(Number(e.gst_amount))} ≠ ${money(printed!)} on the receipt`];
          })(),
          // A GST credit over $82.50 needs a tax invoice (#38).
          ...(mayLackTaxInvoice({
            gst: Number(e.gst_amount),
            total: Number(e.total),
            hasAttachment: withFiles.has(e.id),
            vendorAbn: e.vendor_id ? (vendorById.get(e.vendor_id)?.abn ?? null) : null,
          })
            ? [withFiles.has(e.id) ? "GST over $82.50, but no vendor ABN" : "GST over $82.50, but no receipt"]
            : []),
        ],
      },
      lineItems: lines.map((li) => ({
        description_raw: li.description_raw,
        categoryName: li.category_id ? (categoryNameById.get(li.category_id) ?? "—") : "—",
        quantity: li.quantity,
        unit_price: li.unit_price,
        line_total: li.line_total,
      })),
    };
  });

  const waitingTotal = expenses.reduce((sum, e) => sum + Number(e.total), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        {/* How big the queue is and how long it has waited, before reading any
            of it. Ordered oldest first, so the first row is the oldest. */}
        <p className="page-description mt-1">
          {expenses.length} {expenses.length === 1 ? "expense" : "expenses"} · {money(waitingTotal)} · oldest waiting{" "}
          {waitingFor(expenses[0]!.created_at)}
        </p>
      </div>

      {/* The submitter's name only earns its place when there is more than one. */}
      <ApprovalsList expenses={rows} showSubmitter={submitterIds.length > 1} />
    </div>
  );
}
