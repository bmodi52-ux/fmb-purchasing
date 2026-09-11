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
import { matchReceiptLinesAction, type LineMatchResult } from "../../submit/actions";

export type PhotoProductDraft = ExtractedProduct & { match: LineMatchResult | null };

export type ReadPhotosResult = {
  error: string | null;
  store: string | null;
  note: string | null;
  products: PhotoProductDraft[];
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

  const vendorName = String(formData.get("vendor_name") ?? "").trim() || reading.store || "";
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

  return {
    error: null,
    store: reading.store,
    note: reading.note,
    products: reading.products.map((p, i) => ({ ...p, match: matches[String(i)] ?? null })),
  };
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
}): Promise<SaveProductsResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const products = input.products.filter((p) => p.itemId || p.name.trim());
  if (products.length === 0) return { error: "There is nothing to save.", saved: [], vendorId: null };

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
      let packPrice = p.price && p.price > 0 ? p.price : null;
      if (packPrice != null && p.priceIsPer === "unit" && !pack.sold_loose) {
        packPrice = round4(
          packPrice * Number(pack.inner_quantity) * Number(pack.pack_count) * Number(packUnit.to_base_factor)
        );
      }

      // This store's offer on it.
      const { data: offers } = await admin
        .from("pricelist_items")
        .select("id, status, pack_price, brand, created_at")
        .eq("vendor_id", vendorId)
        .eq("pack_size_id", pack.id)
        .neq("status", "rejected");
      const existingOffer = [...(offers ?? [])].sort(
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
        if (p.brand && !existingOffer.brand) changes.brand = { old: null, new: p.brand };
        if (Object.keys(changes).length > 0) {
          await admin
            .from("pricelist_items")
            .update({
              ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.new])),
              updated_at: now,
              updated_by: user.id,
            })
            .eq("id", existingOffer.id);
          await admin
            .from("pricelist_item_history")
            .insert({ item_id: existingOffer.id, changed_by: user.id, changes });
        }
      } else {
        const { error } = await admin.from("pricelist_items").insert({
          pack_size_id: pack.id,
          vendor_id: vendorId,
          brand: p.brand,
          pack_price: packPrice,
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
