"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateReports } from "../../reports/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { leafCategories } from "@/lib/categories";
import { reportError } from "@/lib/errors";
import { checkExtractionThrottle } from "@/lib/extraction-throttle";
import { matchOrCreateVendor, recordVendorItemDescription } from "@/lib/expense-matching";
import { formatPackPrice, isPackaging } from "@/lib/pack-description";
import { extractProducts, type ExtractedProduct, type ProductUnit, type ProductPhotoReading } from "@/lib/product-extraction";
import { isPriceListFile, priceListChunks, readPriceListRows } from "@/lib/price-list-file";
import { LinkUnreadable, parseLink, readProductLink, shopDomain, shopName } from "@/lib/product-link";
import { saleEndFor, settlePrices, type GstAnswer } from "@/lib/offer-pricing";
import { todayIso } from "@/lib/periods-data";
import { matchReceiptLinesAction, type LineMatchResult } from "../../submit/actions";

export type PhotoProductDraft = ExtractedProduct & {
  match: LineMatchResult | null;
  /** What this item's receipts say about GST, as a hint beside the choice (#29). */
  gstHistory: "free" | "taxable" | null;
};

export type ReadPhotosResult = {
  error: string | null;
  store: string | null;
  note: string | null;
  products: PhotoProductDraft[];
  /** A link that couldn't be read, so the page should offer a screenshot instead (#29). */
  linkFailed?: boolean;
  /** The page the products were read from. */
  source?: { url: string; domain: string } | null;
  /** The vendor the store was recognised as, by its website or its name. */
  vendor?: { id: string; name: string } | null;
  /** This shop's last GST answer, offered again (still shown and confirmed). */
  shopGst?: "included" | "excluded" | null;
};

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;
/** Rows of a price list file read at once, and the most read from one file (#29). */
const PRICE_LIST_CHUNK_ROWS = 60;
const MAX_PRICE_LIST_ROWS = 500;
const PRICE_LIST_PARALLEL = 5;

/**
 * A price list file read a piece at a time, a few pieces at once, the
 * products put back in the file's order.
 */
async function readPriceListFile(file: File, categoryNames: string[]): Promise<ProductPhotoReading> {
  const rows = await readPriceListRows({ name: file.name, bytes: await file.arrayBuffer() });
  if (rows.length < 2) throw new Error("That file has no rows under its headings.");
  if (rows.length - 1 > MAX_PRICE_LIST_ROWS) {
    throw new Error(`That list has ${rows.length - 1} rows. Split it into files of up to ${MAX_PRICE_LIST_ROWS} and import each.`);
  }
  const chunks = priceListChunks(rows, PRICE_LIST_CHUNK_ROWS);
  const readings: ProductPhotoReading[] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += PRICE_LIST_PARALLEL) {
    await Promise.all(
      chunks.slice(i, i + PRICE_LIST_PARALLEL).map(async (chunk, j) => {
        readings[i + j] = await extractProducts(
          [{ text: chunk.text, label: `${file.name}, rows ${chunk.from}–${chunk.to}` }],
          categoryNames
        );
      })
    );
  }
  const notes = [...new Set(readings.map((r) => r.note).filter(Boolean))];
  return {
    store: readings.find((r) => r.store)?.store ?? null,
    products: readings.flatMap((r) => r.products),
    note: notes.length ? notes.join(" ") : null,
  };
}

/**
 * The words a product is matched against the Pricelist by: its name, then its
 * packaging and size written the way a receipt line would carry them, so the
 * same matching that reads receipts picks the item and the pack.
 */
function matchingWords(p: ExtractedProduct): string {
  const loose = p.soldAs === "loose";
  const size =
    !loose && p.innerQuantity && p.unit && p.unit !== "each" ? `${p.innerQuantity}${p.unit}` : "";
  const count = !loose && p.packCount && p.packCount > 1 ? `x ${p.packCount}` : "";
  return [p.name, loose ? "loose" : (p.soldAs ?? ""), size, count].filter(Boolean).join(" ");
}

/**
 * Read one or more photos — a price tag, a label, a price list — into products,
 * each already looked up on the Pricelist. Writes nothing.
 */
export async function readProductPhotosAction(formData: FormData): Promise<ReadPhotosResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const empty = { store: null, note: null, products: [] };
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (photos.length === 0) return { error: "Take or choose a photo first.", ...empty };
  if (photos.length > MAX_PHOTOS) return { error: `Up to ${MAX_PHOTOS} photos at a time.`, ...empty };
  const priceLists = photos.filter(isPriceListFile);
  if (priceLists.length > 0 && photos.length > 1) {
    return { error: "Import a price list file on its own, without photos or other files.", ...empty };
  }
  if (priceLists.length === 0 && photos.some((f) => !PHOTO_TYPES.has(f.type))) {
    return { error: "Only photos (JPG, PNG, WebP), a PDF, or a CSV or Excel price list can be read.", ...empty };
  }
  if (photos.some((f) => f.size > MAX_PHOTO_BYTES)) {
    return { error: "One of those files is too large. Try a photo rather than a scan.", ...empty };
  }

  const verdict = await checkExtractionThrottle(user.id);
  if (!verdict.allowed) {
    return {
      error: `That's a lot of photos in one hour. Try again in about ${verdict.retryAfterMinutes} minute${
        verdict.retryAfterMinutes === 1 ? "" : "s"
      }.`,
      ...empty,
    };
  }

  const admin = createAdminClient();
  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryNames = leafCategories(categories ?? []).map((c) => c.name);

  let reading;
  try {
    if (priceLists.length > 0) {
      reading = await readPriceListFile(priceLists[0], categoryNames);
    } else {
      const files = await Promise.all(
        photos.map(async (f) => ({ base64: Buffer.from(await f.arrayBuffer()).toString("base64"), mediaType: f.type }))
      );
      reading = await extractProducts(files, categoryNames);
    }
  } catch (err) {
    await reportError({
      source: "product-photo-extraction",
      error: err,
      detail: photos.map((f) => `${f.type} ${f.size}b`).join(", "),
      userId: user.id,
    });
    return {
      error:
        priceLists.length > 0
          ? `Couldn't read that price list (${(err as Error).message}).`
          : `Couldn't read that photo (${(err as Error).message}). Try again, closer and in focus.`,
      ...empty,
    };
  }

  if (reading.products.length === 0) {
    return {
      error: "No product with a name could be read from that. Try a closer photo of the price tag or label.",
      store: reading.store,
      note: reading.note,
      products: [],
    };
  }

  // A screenshot taken because the page's link couldn't be read keeps the link.
  let source: { url: string; domain: string } | null = null;
  try {
    const sourceLink = String(formData.get("source_link") ?? "").trim();
    if (sourceLink) {
      const url = parseLink(sourceLink).toString();
      source = { url, domain: shopDomain(url) };
    }
  } catch {
    source = null;
  }
  const vendorName =
    String(formData.get("vendor_name") ?? "").trim() || reading.store || (source ? shopName(source.domain, null) : "");
  return afterReading(admin, reading, vendorName, source);
}

/**
 * What a reading needs before it is shown: each product looked up on the
 * Pricelist, the store recognised, and what is already known about GST —
 * the shop's last answer, and whether an item's receipts carried GST.
 */
async function afterReading(
  admin: ReturnType<typeof createAdminClient>,
  reading: ProductPhotoReading,
  vendorName: string,
  source: { url: string; domain: string } | null
): Promise<ReadPhotosResult> {
  const matches = await matchReceiptLinesAction({
    vendorName,
    abn: null,
    lines: reading.products.map((p, i) => ({
      key: String(i),
      description: matchingWords(p),
      categoryName: p.category,
      itemId: null,
      pricelistItemId: null,
    })),
  });

  // The store: by its website first, since a link names it exactly, then by name.
  const vendorColumns = "id, name, quote_gst_basis";
  let vendorRow: { id: string; name: string; quote_gst_basis: string | null } | null = null;
  if (source) {
    const { data } = await admin.from("vendors").select(vendorColumns).ilike("website", source.domain).limit(1);
    vendorRow = data?.[0] ?? null;
  }
  if (!vendorRow && vendorName) {
    const { data } = await admin.from("vendors").select(vendorColumns).ilike("name", vendorName).neq("status", "rejected").limit(1);
    vendorRow = data?.[0] ?? null;
  }

  const itemIds = [...new Set(Object.values(matches).map((m) => m?.itemId).filter((id): id is string => !!id))];
  const gstHistory = await gstHistoryOf(admin, itemIds);

  return {
    error: null,
    store: vendorRow?.name ?? reading.store,
    note: reading.note,
    products: reading.products.map((p, i) => {
      const match = matches[String(i)] ?? null;
      return { ...p, match, gstHistory: match?.itemId ? (gstHistory.get(match.itemId) ?? null) : null };
    }),
    source,
    vendor: vendorRow ? { id: vendorRow.id, name: vendorRow.name } : null,
    shopGst:
      vendorRow?.quote_gst_basis === "included" || vendorRow?.quote_gst_basis === "excluded"
        ? vendorRow.quote_gst_basis
        : null,
  };
}

/** Whether each item's receipt lines carried GST: all without is "free", any with is "taxable". */
async function gstHistoryOf(
  admin: ReturnType<typeof createAdminClient>,
  itemIds: string[]
): Promise<Map<string, "free" | "taxable">> {
  const result = new Map<string, "free" | "taxable">();
  if (itemIds.length === 0) return result;
  const { data: offers } = await admin
    .from("pricelist_items")
    .select("id, item_pack_sizes!inner(item_id)")
    .in("item_pack_sizes.item_id", itemIds);
  const itemOfOffer = new Map(
    (offers ?? []).map((o) => {
      const pack = o.item_pack_sizes as unknown as { item_id: string } | { item_id: string }[];
      return [o.id as string, Array.isArray(pack) ? pack[0]?.item_id : pack.item_id];
    })
  );
  if (itemOfOffer.size === 0) return result;
  const { data: lines } = await admin
    .from("expense_line_items")
    .select("pricelist_item_id, gst_applicable")
    .in("pricelist_item_id", [...itemOfOffer.keys()])
    .not("gst_applicable", "is", null);
  for (const line of lines ?? []) {
    const itemId = itemOfOffer.get(line.pricelist_item_id as string);
    if (!itemId) continue;
    if (line.gst_applicable) result.set(itemId, "taxable");
    else if (!result.has(itemId)) result.set(itemId, "free");
  }
  return result;
}

/**
 * Read a shop's product page from a pasted link (#29). Writes nothing. When
 * the page can't be read, or gives no price for its product, says so with
 * `linkFailed`, and the page offers a screenshot instead — Costco publishes
 * no price in its pages, and any shop can block a server.
 */
export async function readProductLinkAction(formData: FormData): Promise<ReadPhotosResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const empty = { store: null, note: null, products: [] };
  const link = String(formData.get("link") ?? "").trim();
  if (!link) return { error: "Paste the link to the product's page first.", ...empty };

  const verdict = await checkExtractionThrottle(user.id);
  if (!verdict.allowed) {
    return { error: `That's a lot read in one hour. Try again in about ${verdict.retryAfterMinutes} minutes.`, ...empty };
  }

  let page;
  try {
    page = await readProductLink(link);
  } catch (err) {
    if (err instanceof LinkUnreadable) return { error: err.message, linkFailed: true, ...empty };
    await reportError({ source: "product-link", error: err, detail: link, userId: user.id });
    return { error: "That page couldn't be read.", linkFailed: true, ...empty };
  }

  const admin = createAdminClient();
  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryNames = leafCategories(categories ?? []).map((c) => c.name);

  let reading: ProductPhotoReading;
  try {
    reading = await extractProducts([{ text: page.text, label: `The shop's page` }], categoryNames);
  } catch (err) {
    await reportError({ source: "product-link", error: err, detail: link, userId: user.id });
    return { error: "That page couldn't be read.", linkFailed: true, ...empty };
  }

  // A product page is one product; one read without a price is no use.
  const product = reading.products[0];
  if (!product || product.price == null) {
    return {
      error: `${page.store}'s page doesn't show that product's price to the app.`,
      linkFailed: true,
      ...empty,
    };
  }

  const vendorName = String(formData.get("vendor_name") ?? "").trim() || page.store;
  return afterReading(admin, { ...reading, store: page.store, products: [product] }, vendorName, {
    url: page.url,
    domain: page.domain,
  });
}

export type ProductToSave = {
  /** An item already on the Pricelist, or null to add a new one. */
  itemId: string | null;
  /** One of that item's pack sizes, or null to use or add the size described. */
  packSizeId: string | null;
  name: string;
  brand: string | null;
  printedName: string | null;
  soldAs: string | null;
  innerQuantity: number | null;
  unit: ProductUnit | null;
  packCount: number | null;
  price: number | null;
  priceIsPer: "pack" | "unit" | null;
  category: string | null;
  /** The usual price when `price` is a special (#29). */
  regularPrice: number | null;
  /** The special's last day as shown, or null to take the shop's usual week. */
  specialEndsOn: string | null;
  /** How GST was settled — always asked, never assumed (#29). */
  gst: GstAnswer;
};

export type SavedProduct = { name: string; itemId: string; priceText: string | null; keptPrice: boolean };

export type SaveProductsResult = { error: string | null; saved: SavedProduct[]; vendorId: string | null };

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Turn plain answers into Pricelist records: the item, its pack size and this
 * store's price — found where they already exist, added where they don't.
 *
 * Nobody is asked to set up a pack size; the answers are what it is made of.
 * Whoever may edit the Pricelist adds approved records and can update a price
 * already on file. Anyone else adds records for review and never overwrites an
 * existing price — a shelf photo is good evidence, but one person's snapshot
 * should not quietly restate what the Pricelist says.
 */
export async function saveProductsAction(input: {
  vendorId: string | null;
  vendorName: string;
  products: ProductToSave[];
  /** The shop's page these were read from, when they came from a link (#29). */
  source?: { url: string; domain: string } | null;
}): Promise<SaveProductsResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const products = input.products.filter((p) => p.itemId || p.name.trim());
  if (products.length === 0) return { error: "There is nothing to save.", saved: [], vendorId: null };
  if (products.some((p) => !["included", "excluded", "free"].includes(p.gst))) {
    return { error: "Say for each price whether it includes GST.", saved: [], vendorId: null };
  }
  const source = input.source ?? null;
  const today = todayIso();

  const permissions = await getUserPermissions(user);
  const trusted = can(permissions, "pricelist", "edit_master_data");
  const now = new Date().toISOString();
  const status = trusted ? "approved" : "pending";
  const reviewed = trusted ? { reviewed_by: user.id, reviewed_at: now } : {};

  const admin = createAdminClient();

  let vendorId: string | null = null;
  if (input.vendorId) {
    const { data } = await admin.from("vendors").select("id").eq("id", input.vendorId).maybeSingle();
    vendorId = (data?.id as string | undefined) ?? null;
  } else if (input.vendorName.trim()) {
    vendorId = (await matchOrCreateVendor(admin, { name: input.vendorName, abn: null, userId: user.id })).id;
  }
  if (!vendorId) return { error: "Say which store or supplier this is from.", saved: [], vendorId: null };

  // What is now known about the shop: its website, so its next link finds it,
  // and how its prices stand on GST, offered again next time (#29).
  const shopGst = [...products].reverse().find((p) => p.gst !== "free")?.gst ?? null;
  const { data: shop } = await admin.from("vendors").select("name, website").eq("id", vendorId).maybeSingle();
  if (shopGst) await admin.from("vendors").update({ quote_gst_basis: shopGst }).eq("id", vendorId);
  // Separately, and allowed to fail: a website another vendor already has
  // stays with that vendor (unique index), and must not cost the GST answer.
  if (source && !shop?.website) await admin.from("vendors").update({ website: source.domain }).eq("id", vendorId);
  const shopForSales = source?.domain ?? ((shop?.name as string | undefined) || input.vendorName);

  const [{ data: units }, { data: categories }] = await Promise.all([
    admin.from("units").select("id, code, label, base_unit_code, to_base_factor"),
    admin.from("categories").select("id, name, parent_category_id"),
  ]);
  const unitByCode = new Map(
    (units ?? []).map((u) => [
      (u.code as string).toLowerCase(),
      u as { id: string; code: string; label: string; base_unit_code: string; to_base_factor: number },
    ])
  );
  const unitById = new Map([...unitByCode.values()].map((u) => [u.id, u]));
  const categoryIdByName = new Map(leafCategories(categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  const saved: SavedProduct[] = [];

  try {
    for (const p of products) {
      const loose = p.soldAs === "loose";
      const unit = unitByCode.get((p.unit && p.unit !== "each" ? p.unit : "ea").toLowerCase()) ?? unitByCode.get("ea");
      if (!unit) throw new Error("No units are set up.");

      // The item.
      let itemId: string | null = null;
      if (p.itemId) {
        const { data } = await admin.from("items").select("id").eq("id", p.itemId).maybeSingle();
        itemId = (data?.id as string | undefined) ?? null;
      }
      if (!itemId) {
        const name = p.name.trim();
        const categoryId = p.category ? (categoryIdByName.get(p.category.toLowerCase()) ?? null) : null;
        const lookup = admin.from("items").select("id").ilike("name", name).limit(1);
        const { data: existing } = await (categoryId ? lookup.eq("category_id", categoryId) : lookup.is("category_id", null));
        if (existing?.[0]) {
          itemId = existing[0].id as string;
        } else {
          const canonical = unitByCode.get(unit.base_unit_code.toLowerCase()) ?? unit;
          const { data: created, error } = await admin
            .from("items")
            .insert({
              name,
              category_id: categoryId,
              canonical_unit_id: canonical.id,
              status,
              created_by: user.id,
              updated_by: user.id,
              ...reviewed,
            })
            .select("id")
            .single();
          if (error) throw error;
          itemId = created.id as string;
        }
      }

      // The pack size.
      let pack: { id: string; inner_quantity: number; inner_unit_id: string; pack_count: number; sold_loose: boolean; packaging: string | null } | null =
        null;
      const packColumns = "id, inner_quantity, inner_unit_id, pack_count, sold_loose, packaging";
      if (p.packSizeId) {
        const { data } = await admin
          .from("item_pack_sizes")
          .select(packColumns)
          .eq("id", p.packSizeId)
          .eq("item_id", itemId)
          .maybeSingle();
        pack = data;
      }
      if (!pack) {
        const innerQuantity = loose ? 1 : (p.innerQuantity ?? 1);
        const packCount = loose ? 1 : Math.max(1, Math.round(p.packCount ?? 1));
        const { data: sameShape } = await admin
          .from("item_pack_sizes")
          .select(packColumns)
          .eq("item_id", itemId)
          .eq("inner_quantity", innerQuantity)
          .eq("inner_unit_id", unit.id)
          .eq("pack_count", packCount)
          .eq("sold_loose", loose)
          .limit(1);
        pack = sameShape?.[0] ?? null;
        if (!pack) {
          const { data: created, error } = await admin
            .from("item_pack_sizes")
            .insert({
              item_id: itemId,
              inner_quantity: innerQuantity,
              inner_unit_id: unit.id,
              pack_count: packCount,
              sold_loose: loose,
              packaging: !loose && isPackaging(p.soldAs) ? p.soldAs : null,
              contents_confirmed: true,
              created_by: user.id,
            })
            .select(packColumns)
            .single();
          if (error) throw error;
          pack = created;
        }
      }
      const packUnit = unitById.get(pack.inner_unit_id) ?? unit;
      const shape = {
        innerQuantity: pack.inner_quantity,
        unitLabel: packUnit.label,
        packCount: pack.pack_count,
        soldLoose: pack.sold_loose,
        packaging: pack.packaging,
      };

      // The price of that pack. A tag that only gave a price per kg is turned
      // into the price of the whole pack, through the units table.
      const perPack = (n: number | null) =>
        n != null && n > 0 && p.priceIsPer === "unit" && !pack.sold_loose
          ? round4(n * Number(pack.inner_quantity) * Number(pack.pack_count) * Number(packUnit.to_base_factor))
          : n != null && n > 0
            ? n
            : null;
      // The regular price is the offer's price; a special sits beside it with
      // its last day, and GST is settled the way the person said (#29).
      const settled = settlePrices({ price: perPack(p.price), regularPrice: perPack(p.regularPrice), gst: p.gst });
      const packPrice = settled.packPrice;
      const sale =
        settled.salePrice != null
          ? {
              sale_price: settled.salePrice,
              sale_ends_on: p.specialEndsOn ?? saleEndFor(shopForSales, today),
              sale_end_assumed: !p.specialEndsOn,
            }
          : { sale_price: null, sale_ends_on: null, sale_end_assumed: false };
      const provenance = {
        gst_basis: settled.gstBasis,
        price_read_at: now,
        ...(source ? { source_url: source.url } : {}),
      };

      // This store's offer on it, in this brand: two brands of the same size
      // at one shop are two prices, so the cheapest of each can be found.
      const brand = p.brand?.trim() || null;
      const { data: offers } = await admin
        .from("pricelist_items")
        .select("id, status, pack_price, brand, created_at")
        .eq("vendor_id", vendorId)
        .eq("pack_size_id", pack.id)
        .neq("status", "rejected");
      const sameBrand = (offers ?? []).filter((o) =>
        brand ? String(o.brand ?? "").toLowerCase() === brand.toLowerCase() || !o.brand : true
      );
      const existingOffer = [...sameBrand].sort(
        (a, b) =>
          Number(b.status === "approved") - Number(a.status === "approved") ||
          String(a.created_at).localeCompare(String(b.created_at))
      )[0];

      let keptPrice = false;
      if (existingOffer) {
        const current = existingOffer.pack_price != null ? Number(existingOffer.pack_price) : null;
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        if (packPrice != null && current !== packPrice) {
          if (trusted || current == null) changes.pack_price = { old: current, new: packPrice };
          else keptPrice = true;
        }
        if (brand && !existingOffer.brand) changes.brand = { old: null, new: brand };
        // A price that stands (new, confirmed, or allowed to change) brings its
        // special, source and date with it; one kept for review changes none.
        const { data: onFile } = await admin
          .from("pricelist_items")
          .select("sale_price")
          .eq("id", existingOffer.id)
          .maybeSingle();
        const currentSale = onFile?.sale_price != null ? Number(onFile.sale_price) : null;
        if (!keptPrice && currentSale !== sale.sale_price) {
          changes.sale_price = { old: currentSale, new: sale.sale_price };
        }
        if (Object.keys(changes).length > 0 || !keptPrice) {
          await admin
            .from("pricelist_items")
            .update({
              ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.new])),
              ...(keptPrice ? {} : { ...sale, ...provenance }),
              updated_at: now,
              updated_by: user.id,
            })
            .eq("id", existingOffer.id);
        }
        if (Object.keys(changes).length > 0) {
          await admin
            .from("pricelist_item_history")
            .insert({ item_id: existingOffer.id, changed_by: user.id, changes });
        }
      } else {
        const { error } = await admin.from("pricelist_items").insert({
          pack_size_id: pack.id,
          vendor_id: vendorId,
          brand,
          pack_price: packPrice,
          ...sale,
          ...provenance,
          status,
          created_by: user.id,
          updated_by: user.id,
          ...reviewed,
        });
        if (error) throw error;
      }

      // So the next receipt from this store saying the same thing matches.
      await recordVendorItemDescription(admin, {
        itemId,
        vendorId,
        description: p.printedName ?? p.name,
        userId: user.id,
      });

      const shownPrice = keptPrice && existingOffer?.pack_price != null ? Number(existingOffer.pack_price) : packPrice;
      saved.push({
        name: p.name.trim() || "Item",
        itemId,
        priceText: shownPrice != null ? formatPackPrice(shownPrice, shape) : null,
        keptPrice,
      });
    }
  } catch (err) {
    await reportError({ source: "product-photo-save", error: err, userId: user.id });
    return {
      error: `Saved ${saved.length} of ${products.length} before something went wrong (${(err as Error).message}).`,
      saved,
      vendorId,
    };
  }

  revalidatePath("/pricelist");
  revalidatePath("/pricelist/[id]", "page");
  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath("/review-queue");
  revalidateReports();
  return { error: null, saved, vendorId };
}
