"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { extractReceipt, type ExtractedReceipt } from "@/lib/receipt-extraction";
import { lookupAbn, type AbnLookupResult } from "@/lib/abn-lookup";
import { matchOrCreateVendor, matchOrCreateOffer } from "@/lib/expense-matching";
import { fiscalYearHijri } from "@/lib/fiscal-year";
import { notifyExpenseSubmitted } from "@/lib/expense-notifications";
import { leafCategories } from "@/lib/categories";

export type ExtractState = {
  data: ExtractedReceipt | null;
  receiptPath: string | null;
  error: string | null;
};

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function extractReceiptAction(
  _prev: ExtractState,
  formData: FormData
): Promise<ExtractState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { data: null, receiptPath: null, error: "Choose a receipt photo or PDF first." };
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return { data: null, receiptPath: null, error: "Only JPG, PNG, WebP, or PDF files are supported." };
  }

  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error: uploadError } = await admin.storage.from("receipts").upload(path, bytes, {
    contentType: file.type,
  });
  if (uploadError) {
    return { data: null, receiptPath: null, error: `Could not save the receipt file: ${uploadError.message}` };
  }

  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id").order("sort_order");
  const categoryNames = leafCategories(categories ?? []).map((c) => c.name);

  try {
    const base64 = Buffer.from(bytes).toString("base64");
    const extracted = await extractReceipt(base64, file.type, categoryNames);
    return { data: extracted, receiptPath: path, error: null };
  } catch (err) {
    return {
      data: null,
      receiptPath: path,
      error: `Could not read that receipt automatically (${(err as Error).message}). You can still fill in the details manually.`,
    };
  }
}

export async function lookupAbnAction(abn: string): Promise<AbnLookupResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");
  return lookupAbn(abn);
}

export type UploadFileState = { path: string | null; fileName: string | null; error: string | null };

/** Attach a receipt during manual entry, without triggering AI extraction. */
export async function uploadReceiptFileAction(
  _prev: UploadFileState,
  formData: FormData
): Promise<UploadFileState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { path: null, fileName: null, error: "Choose a file first." };
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return { path: null, fileName: null, error: "Only JPG, PNG, WebP, or PDF files are supported." };
  }

  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error } = await admin.storage.from("receipts").upload(path, bytes, { contentType: file.type });
  if (error) return { path: null, fileName: null, error: `Could not save the file: ${error.message}` };

  return { path, fileName: file.name, error: null };
}

export type VendorLookupSuggestion = { id: string; vendorNumber: string | null; name: string };

/** Vendor #/name typeahead for manual entry (§ user feedback). */
export async function searchVendorsAction(query: string): Promise<VendorLookupSuggestion[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("vendors")
    .select("id, vendor_number, name")
    .or(`vendor_number.ilike.%${trimmed}%,name.ilike.%${trimmed}%`)
    .eq("status", "approved")
    .limit(8);

  return (data ?? []).map((v) => ({ id: v.id, vendorNumber: v.vendor_number, name: v.name }));
}

export type ItemLookupSuggestion = {
  id: string;
  itemNumber: string | null;
  description: string;
  packSizeLabel: string | null;
  brand: string | null;
  vendorName: string | null;
  categoryName: string | null;
};

function formatPackSizeLabel(
  packSize: { inner_quantity: number; pack_count: number; total_quantity: number },
  unitLabel: string
): string {
  return packSize.pack_count > 1
    ? `${packSize.inner_quantity} ${unitLabel} × ${packSize.pack_count}`.trim()
    : `${packSize.inner_quantity} ${unitLabel}`.trim();
}

/** Item #/name typeahead for manual entry line items — matches at the Item
 * level, then surfaces each approved vendor offer under it (pack size +
 * vendor) as a separate suggestion. */
export async function searchPricelistItemsAction(query: string): Promise<ItemLookupSuggestion[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const admin = createAdminClient();

  const { data: matchedItems } = await admin
    .from("items")
    .select("id, item_number, name, category_id")
    .or(`item_number.ilike.%${trimmed}%,name.ilike.%${trimmed}%`)
    .limit(20);
  const itemById = new Map((matchedItems ?? []).map((i) => [i.id, i]));
  const itemIds = [...itemById.keys()];
  if (itemIds.length === 0) return [];

  const { data: packSizes } = await admin
    .from("item_pack_sizes")
    .select("id, item_id, inner_quantity, inner_unit_id, pack_count, total_quantity")
    .in("item_id", itemIds);
  const packSizeById = new Map((packSizes ?? []).map((p) => [p.id, p]));
  const packSizeIds = [...packSizeById.keys()];
  if (packSizeIds.length === 0) return [];

  const { data: offers } = await admin
    .from("pricelist_items")
    .select("id, vendor_id, brand, pack_size_id")
    .in("pack_size_id", packSizeIds)
    .eq("status", "approved")
    .limit(8);

  const rows = offers ?? [];
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter(Boolean))];
  const categoryIds = [...new Set([...itemById.values()].map((i) => i.category_id).filter(Boolean))];

  const [{ data: vendors }, { data: categories }, { data: units }] = await Promise.all([
    vendorIds.length ? admin.from("vendors").select("id, name").in("id", vendorIds) : { data: [] },
    categoryIds.length ? admin.from("categories").select("id, name").in("id", categoryIds) : { data: [] },
    admin.from("units").select("id, label"),
  ]);
  const vendorNameById = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

  return rows.map((r) => {
    const packSize = packSizeById.get(r.pack_size_id)!;
    const item = itemById.get(packSize.item_id)!;
    return {
      id: r.id,
      itemNumber: item.item_number,
      description: item.name,
      packSizeLabel: formatPackSizeLabel(packSize, unitLabelById.get(packSize.inner_unit_id) ?? ""),
      brand: r.brand,
      vendorName: r.vendor_id ? (vendorNameById.get(r.vendor_id) ?? null) : null,
      categoryName: item.category_id ? (categoryNameById.get(item.category_id) ?? null) : null,
    };
  });
}

export type LineItemInput = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  categoryName: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
};

export type CreateExpenseInput = {
  vendorName: string;
  abn: string | null;
  invoiceNumber: string | null;
  receiptDate: string | null;
  receiptPath: string | null;
  subtotal: number;
  gstAmount: number;
  total: number;
  lineItems: LineItemInput[];
};

export async function createExpense(
  input: CreateExpenseInput
): Promise<{ error: string } | { expenseId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  if (!input.vendorName.trim()) return { error: "Vendor is required." };
  if (input.lineItems.length === 0) return { error: "Add at least one line item." };

  const admin = createAdminClient();

  const vendor = await matchOrCreateVendor(admin, {
    name: input.vendorName,
    abn: input.abn,
    userId: user.id,
  });

  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryIdByName = new Map(leafCategories(categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  const receiptDate = input.receiptDate ? new Date(input.receiptDate) : new Date();
  const fiscalYear = fiscalYearHijri(receiptDate);

  const { data: expense, error: expenseError } = await admin
    .from("expenses")
    .insert({
      submitted_by: user.id,
      vendor_id: vendor.id,
      vendor_name_raw: input.vendorName,
      invoice_number: input.invoiceNumber,
      receipt_date: input.receiptDate,
      receipt_file_path: input.receiptPath,
      subtotal: input.subtotal,
      gst_amount: input.gstAmount,
      total: input.total,
      status: "submitted",
      fiscal_year_hijri: fiscalYear,
    })
    .select("id")
    .single();

  if (expenseError || !expense) {
    return { error: expenseError?.message ?? "Could not create the expense." };
  }

  for (const [index, item] of input.lineItems.entries()) {
    const categoryId = item.categoryName
      ? (categoryIdByName.get(item.categoryName.toLowerCase()) ?? null)
      : null;

    const matched = await matchOrCreateOffer(admin, {
      vendorId: vendor.id,
      description: item.description,
      categoryId,
      userId: user.id,
      normalizedUnit: item.normalizedUnit,
    });

    const lineGst = input.total > 0 ? Math.round(((item.lineTotal / input.total) * input.gstAmount) * 100) / 100 : 0;

    await admin.from("expense_line_items").insert({
      expense_id: expense.id,
      pricelist_item_id: matched.id,
      description_raw: item.description,
      category_id: categoryId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_subtotal: Math.round((item.lineTotal - lineGst) * 100) / 100,
      line_gst: lineGst,
      line_total: item.lineTotal,
      normalized_quantity: item.normalizedQuantity,
      normalized_unit: item.normalizedUnit,
      sort_order: index,
    });
  }

  await admin.from("expense_status_history").insert({
    expense_id: expense.id,
    from_status: null,
    to_status: "submitted",
    actor_id: user.id,
  });

  await notifyExpenseSubmitted({
    id: expense.id,
    vendor_name_raw: input.vendorName,
    total: input.total,
    submitted_by: user.id,
  });

  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  return { expenseId: expense.id };
}

export type ExpenseForEdit = CreateExpenseInput & { id: string };

/** Fetch an expense + line items for editing — only while it's still "submitted" (§3). */
export async function getExpenseForEdit(expenseId: string): Promise<ExpenseForEdit | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");

  const admin = createAdminClient();
  const { data: expense } = await admin.from("expenses").select("*").eq("id", expenseId).maybeSingle();
  if (!expense || expense.submitted_by !== user.id || expense.status !== "submitted") return null;

  const { data: lineItems } = await admin
    .from("expense_line_items")
    .select("description_raw, quantity, unit_price, line_total, category_id, normalized_quantity, normalized_unit")
    .eq("expense_id", expenseId)
    .order("sort_order");

  const categoryIds = [...new Set((lineItems ?? []).map((li) => li.category_id).filter(Boolean))];
  const { data: categories } = categoryIds.length
    ? await admin.from("categories").select("id, name").in("id", categoryIds)
    : { data: [] };
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));

  return {
    id: expense.id,
    vendorName: expense.vendor_name_raw ?? "",
    abn: null,
    invoiceNumber: expense.invoice_number,
    receiptDate: expense.receipt_date,
    receiptPath: expense.receipt_file_path,
    subtotal: expense.subtotal,
    gstAmount: expense.gst_amount,
    total: expense.total,
    lineItems: (lineItems ?? []).map((li) => ({
      description: li.description_raw,
      quantity: li.quantity,
      unitPrice: li.unit_price,
      lineTotal: li.line_total,
      categoryName: li.category_id ? (categoryNameById.get(li.category_id) ?? null) : null,
      normalizedQuantity: li.normalized_quantity,
      normalizedUnit: li.normalized_unit,
    })),
  };
}

export async function updateExpense(
  expenseId: string,
  input: CreateExpenseInput
): Promise<{ error: string } | { expenseId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");

  if (!input.vendorName.trim()) return { error: "Vendor is required." };
  if (input.lineItems.length === 0) return { error: "Add at least one line item." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("expenses")
    .select("id, submitted_by, status")
    .eq("id", expenseId)
    .maybeSingle();
  if (!existing || existing.submitted_by !== user.id || existing.status !== "submitted") {
    return { error: "This expense can no longer be edited." };
  }

  const vendor = await matchOrCreateVendor(admin, {
    name: input.vendorName,
    abn: input.abn,
    userId: user.id,
  });

  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryIdByName = new Map(leafCategories(categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  const receiptDate = input.receiptDate ? new Date(input.receiptDate) : new Date();
  const fiscalYear = fiscalYearHijri(receiptDate);

  const { error: updateError } = await admin
    .from("expenses")
    .update({
      vendor_id: vendor.id,
      vendor_name_raw: input.vendorName,
      invoice_number: input.invoiceNumber,
      receipt_date: input.receiptDate,
      receipt_file_path: input.receiptPath,
      subtotal: input.subtotal,
      gst_amount: input.gstAmount,
      total: input.total,
      fiscal_year_hijri: fiscalYear,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId);
  if (updateError) return { error: updateError.message };

  await admin.from("expense_line_items").delete().eq("expense_id", expenseId);

  for (const [index, item] of input.lineItems.entries()) {
    const categoryId = item.categoryName
      ? (categoryIdByName.get(item.categoryName.toLowerCase()) ?? null)
      : null;

    const matched = await matchOrCreateOffer(admin, {
      vendorId: vendor.id,
      description: item.description,
      categoryId,
      userId: user.id,
      normalizedUnit: item.normalizedUnit,
    });

    const lineGst = input.total > 0 ? Math.round(((item.lineTotal / input.total) * input.gstAmount) * 100) / 100 : 0;

    await admin.from("expense_line_items").insert({
      expense_id: expenseId,
      pricelist_item_id: matched.id,
      description_raw: item.description,
      category_id: categoryId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_subtotal: Math.round((item.lineTotal - lineGst) * 100) / 100,
      line_gst: lineGst,
      line_total: item.lineTotal,
      normalized_quantity: item.normalizedQuantity,
      normalized_unit: item.normalizedUnit,
      sort_order: index,
    });
  }

  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  return { expenseId };
}
