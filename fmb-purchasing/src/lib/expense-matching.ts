import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalUnitCode } from "@/lib/units";
import { packShapeFromDescription, type PackShape } from "@/lib/pack-shape";
import { packagingFromText } from "@/lib/pack-description";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

type VendorCandidate = { id: string; status: string; created_at: string };

/**
 * Which of several matching vendors is *the* vendor.
 *
 * Exported so the read-only resolver behind the submit form agrees with the
 * write path by construction: the row the form tells the submitter it matched
 * has to be the row the submission is then filed against.
 *
 * A reviewed vendor wins over a provisional one — somebody looked at it, and
 * its vendor_number is the one already written on paperwork — then the oldest,
 * then lowest id so the answer never depends on what order Postgres felt like
 * returning. Migration 0034 merges duplicates on this same ordering, so the
 * winner here is the row that survives a merge.
 */
export function preferredVendor<T extends VendorCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const reviewed = Number(b.status === "approved") - Number(a.status === "approved");
    if (reviewed !== 0) return reviewed;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}

/**
 * One vendor, or null — never an error because several rows matched.
 *
 * Deliberately not .maybeSingle(): PostgREST fails that outright on more than
 * one row, and matchOrCreateVendor used to discard the failure, so a vendor
 * recorded twice matched zero times and a third copy was inserted. A genuine
 * query error still throws, so a dropped connection cannot pass itself off as
 * "no such vendor" and quietly create one.
 */
async function findVendor(
  admin: SupabaseClient,
  column: "abn" | "name",
  value: string
): Promise<string | null> {
  const base = admin.from("vendors").select("id, status, created_at");
  const { data, error } = await (column === "abn"
    ? base.eq("abn", value)
    : base.ilike("name", value)
  ).limit(VENDOR_MATCH_CANDIDATES);
  if (error) throw error;
  return preferredVendor((data ?? []) as VendorCandidate[])?.id ?? null;
}

/**
 * Enough rows to choose sensibly among duplicates, few enough that a
 * pathological name ("Foodworks") cannot drag the whole table across the
 * Pacific. Once 0034 has run there is normally exactly one.
 */
const VENDOR_MATCH_CANDIDATES = 20;

/**
 * Match the extracted/typed vendor against the Vendors table (§3.1.1).
 * ABN is the strongest signal when present; otherwise falls back to a
 * case-insensitive exact name match. No match -> new provisional vendor.
 */
export async function matchOrCreateVendor(
  admin: SupabaseClient,
  { name, abn, userId }: { name: string; abn: string | null; userId: string }
): Promise<{ id: string; status: "matched" | "created" }> {
  const cleanAbn = abn?.replace(/\D/g, "") || null;

  if (cleanAbn) {
    const byAbn = await findVendor(admin, "abn", cleanAbn);
    if (byAbn) return { id: byAbn, status: "matched" };
  }

  const byName = await findVendor(admin, "name", normalize(name));
  if (byName) return { id: byName, status: "matched" };

  const { data: created, error } = await admin
    .from("vendors")
    .insert({ name: name.trim(), abn: cleanAbn, status: "pending", created_by: userId })
    .select("id")
    .single();

  // Two submissions of the same new vendor can race between the lookups above
  // and this insert. The unique index from 0034 is what makes that safe: the
  // loser is told the ABN is taken, and the vendor it wanted is now there to
  // be found.
  if (error) {
    if (cleanAbn && error.code === "23505") {
      const raced = await findVendor(admin, "abn", cleanAbn);
      if (raced) return { id: raced, status: "matched" };
    }
    throw error;
  }
  return { id: created.id, status: "created" };
}

async function unitIdByCode(admin: SupabaseClient, code: string): Promise<string | null> {
  const { data } = await admin.from("units").select("id").eq("code", code).maybeSingle();
  return data?.id ?? null;
}

/**
 * A quantity in a mass or volume unit is already expressed in the terms we
 * cost by, so "80 kg purchased" needs nothing further from a human. A count
 * ("12") is ambiguous — twelve eggs or twelve trays of thirty? — and only the
 * Pricelist reviewer can say, so those packs stay unconfirmed.
 */
async function isSelfEvidentQuantity(admin: SupabaseClient, unitId: string): Promise<boolean> {
  const { data } = await admin.from("units").select("dimension").eq("id", unitId).maybeSingle();
  return data?.dimension === "mass" || data?.dimension === "volume";
}

/**
 * Resolve receipt-extracted unit text against the existing units picklist.
 * Never creates a unit: doing so previously turned every spelling variant
 * ("kg", "kgs", "kilo") into its own incomparable unit, which broke the
 * per-unit cost comparison the Pricelist exists for. Unrecognised text falls
 * back to the caller's unit instead.
 */
async function resolveUnitId(
  admin: SupabaseClient,
  raw: string | null,
  fallbackUnitId: string | null
): Promise<string | null> {
  const canonical = canonicalUnitCode(raw);
  if (canonical) {
    const id = await unitIdByCode(admin, canonical);
    if (id) return id;
  }

  // an admin may have added a bespoke unit (e.g. "bunch") — match that directly
  const trimmed = (raw ?? "").trim();
  if (trimmed) {
    const { data } = await admin.from("units").select("id").ilike("code", trimmed).maybeSingle();
    if (data) return data.id;
  }

  return fallbackUnitId;
}

/**
 * The item a remembered receipt wording belongs to, or null.
 *
 * Scoped to the category when the receipt gave one, since the same wording
 * under two categories is two different products by this app's own rules.
 * Deliberately refuses to guess when more than one item claims the wording:
 * a wrong link here silently attributes spend to the wrong product, which is
 * worse than creating an item somebody has to merge.
 */
async function findItemByDescription(
  admin: SupabaseClient,
  description: string,
  categoryId: string | null
): Promise<string | null> {
  const query = admin
    .from("vendor_item_descriptions")
    .select("item_id, items!inner (category_id)")
    .eq("description_normalized", normalize(description));

  const { data } = await (categoryId
    ? query.eq("items.category_id", categoryId)
    : query);

  const itemIds = [...new Set((data ?? []).map((r) => r.item_id as string))];
  return itemIds.length === 1 ? itemIds[0] : null;
}

/**
 * Remember that this wording means this item, so a later rename can't break
 * the link.
 *
 * Read-then-insert rather than an upsert: the table's unique index is on
 * `coalesce(vendor_id, …)` so that one vendorless wording can't be recorded
 * twice, and PostgREST's on_conflict can only name plain columns. The insert
 * still races against a concurrent identical submission, so a duplicate-key
 * violation is swallowed — that outcome is the one we wanted anyway.
 */
export async function recordVendorItemDescription(
  admin: SupabaseClient,
  {
    itemId,
    vendorId,
    description,
    userId,
  }: { itemId: string; vendorId: string | null; description: string; userId: string | null }
): Promise<void> {
  const trimmed = description.trim();
  if (!trimmed) return;

  const existing = admin
    .from("vendor_item_descriptions")
    .select("id")
    .eq("item_id", itemId)
    .eq("description_normalized", normalize(trimmed));

  const { data: found } = await (vendorId
    ? existing.eq("vendor_id", vendorId)
    : existing.is("vendor_id", null)
  ).maybeSingle();
  if (found) return;

  const { error } = await admin.from("vendor_item_descriptions").insert({
    item_id: itemId,
    vendor_id: vendorId,
    description: trimmed,
    description_normalized: normalize(trimmed),
    created_by: userId,
  });
  if (error && error.code !== "23505") throw error;
}

/**
 * Match/create the top-level Item — one row per canonical product (e.g.
 * "Chicken Thighs", canonical unit kg), independent of vendor or packaging.
 *
 * Scoped by category, matching the unique (category_id, name) constraint from
 * 0009: different meats have different cuts, so "Legs and Shoulders" under
 * Mutton and under Beef are different products and must not collapse into one.
 *
 * Falls back to the wordings recorded in vendor_item_descriptions when the
 * name doesn't match, which is what lets a pricelist item be renamed to
 * something readable without every later receipt for it creating a duplicate.
 * OCR variants nobody has confirmed yet still create an item, and the merge
 * tool folds those together.
 */
export async function matchOrCreateItem(
  admin: SupabaseClient,
  {
    description,
    categoryId,
    normalizedUnit,
    userId,
  }: {
    description: string;
    categoryId: string | null;
    normalizedUnit: string | null;
    userId: string;
  }
): Promise<{ id: string; status: "matched" | "created"; categoryId: string | null }> {
  const name = normalize(description);

  const lookup = admin.from("items").select("id, category_id").ilike("name", name);
  const { data: existing } = await (categoryId
    ? lookup.eq("category_id", categoryId)
    : lookup.is("category_id", null)
  ).maybeSingle();
  if (existing) {
    return { id: existing.id, status: "matched", categoryId: existing.category_id };
  }

  const byDescription = await findItemByDescription(admin, description, categoryId);
  if (byDescription) {
    // The matched item's own category wins over whatever the receipt suggested.
    // A person put it there; the extraction only guessed, and when it returned
    // "unclear" there is nothing to prefer anyway.
    const { data: matchedItem } = await admin
      .from("items")
      .select("category_id")
      .eq("id", byDescription)
      .single();
    return { id: byDescription, status: "matched", categoryId: matchedItem?.category_id ?? null };
  }

  const fallbackUnitId = await unitIdByCode(admin, "ea");
  const canonicalUnitId = await resolveUnitId(admin, normalizedUnit, fallbackUnitId);
  if (!canonicalUnitId) throw new Error("No units are configured — seed the units picklist first.");

  const { data: created, error } = await admin
    .from("items")
    .insert({
      name: description.trim(),
      canonical_unit_id: canonicalUnitId,
      category_id: categoryId,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, status: "created", categoryId };
}

/**
 * Match/create the pack size an offer is sold in, nested under an Item.
 *
 * Always the plain "one unit" shape. A receipt line tells us how much was
 * bought, not how the vendor packages it — reading "80 kg purchased" as an
 * "80 kg pack size" is what produced nonsense pack sizes previously. The
 * quantity bought lives on the expense line item, where it drives
 * item_paid_unit_costs; real pack shapes (1 L x 10 and the like) are entered
 * by a human on the item page.
 *
 * Weight and volume packs are marked confirmed straight away since the
 * receipt quantity is already in costing terms. Countable ones are left
 * unconfirmed: "12 @ $60" could be twelve eggs or twelve trays of thirty, and
 * until someone says which, any per-unit figure derived from it is a guess.
 */
async function matchOrCreatePackSize(
  admin: SupabaseClient,
  {
    itemId,
    canonicalUnitId,
    normalizedUnit,
    description,
  }: {
    itemId: string;
    canonicalUnitId: string;
    normalizedUnit: string | null;
    /**
     * The line's own wording, read for a pack the vendor has stated —
     * "Rice 5kg x 4". Not the same evidence as the quantity bought, which
     * still cannot be used for this; see packShapeFromDescription.
     */
    description?: string | null;
  }
): Promise<string> {
  // A shape the description states wins over "one unit". Everything else
  // about this function stays as it was, including what happens when it says
  // nothing: setting up the pack by hand is only skipped when the invoice
  // itself did the describing.
  const stated = packShapeFromDescription(description);
  const statedUnitId = stated ? await unitIdByCode(admin, stated.unitCode) : null;

  const innerUnitId =
    statedUnitId ?? (await resolveUnitId(admin, normalizedUnit, canonicalUnitId)) ?? canonicalUnitId;
  const innerQuantity = statedUnitId ? stated!.innerQuantity : 1;
  const packCount = statedUnitId ? stated!.packCount : 1;

  const { data: existing } = await admin
    .from("item_pack_sizes")
    .select("id")
    .eq("item_id", itemId)
    .eq("inner_quantity", innerQuantity)
    .eq("inner_unit_id", innerUnitId)
    .eq("pack_count", packCount)
    .is("label", null)
    .maybeSingle();
  if (existing) return existing.id;

  const selfEvident = await isSelfEvidentQuantity(admin, innerUnitId);
  // A stated pack of several is a carton, not something sold loose.
  const soldLoose = selfEvident && packCount === 1 && innerQuantity === 1;

  const { data: created, error } = await admin
    .from("item_pack_sizes")
    .insert({
      item_id: itemId,
      inner_quantity: innerQuantity,
      inner_unit_id: innerUnitId,
      pack_count: packCount,
      sold_loose: soldLoose,
      // "Green Chilli 6kg Box" says what it comes in as plainly as its weight.
      packaging: soldLoose ? null : packagingFromText(description),
      contents_confirmed: selfEvident,
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/**
 * The offer this vendor's own wording already resolved to, or null.
 *
 * The strongest signal available: the same vendor writing the same words on
 * a second receipt is all but certainly selling the same thing. Worth
 * short-circuiting on, because the pack size derived from a receipt line is
 * only ever the plain "one unit" shape — once a human has corrected it to
 * what the vendor actually sells (a 5 kg tub), rederiving it would miss and
 * quietly add a second pack size beside the corrected one.
 *
 * Only when exactly one offer is in the frame. Several offers means several
 * pack sizes, and picking wrong would file the spend against the wrong
 * per-unit cost — falling through creates a pending offer somebody reviews
 * instead, which is the failure worth having.
 */
async function findOfferByVendorDescription(
  admin: SupabaseClient,
  vendorId: string,
  description: string
): Promise<string | null> {
  const { data: known } = await admin
    .from("vendor_item_descriptions")
    .select("item_id")
    .eq("vendor_id", vendorId)
    .eq("description_normalized", normalize(description));

  const itemIds = [...new Set((known ?? []).map((r) => r.item_id as string))];
  if (itemIds.length !== 1) return null;

  const { data: packs } = await admin.from("item_pack_sizes").select("id").eq("item_id", itemIds[0]);
  const packIds = (packs ?? []).map((p) => p.id as string);
  if (packIds.length === 0) return null;

  const { data: offers } = await admin
    .from("pricelist_items")
    .select("id")
    .eq("vendor_id", vendorId)
    .in("pack_size_id", packIds);

  return offers?.length === 1 ? (offers[0].id as string) : null;
}

/**
 * Match a line item against that vendor's known offers for the matched pack
 * size (§3.1.2 — scoped to vendor, never across vendors). No match -> new
 * provisional offer under a matched/created Item + pack size.
 *
 * Whichever way it resolves, the receipt's wording is recorded against the
 * item on the way out, so the next receipt saying the same thing matches
 * however the item has been renamed since.
 */
/**
 * Remember what extraction actually read, when a person corrected it.
 *
 * A correction was previously recorded only as its outcome: the tidy wording a
 * human typed got remembered against the item, and the misreading that made
 * them type it was discarded. So the same vendor printing the same awkward
 * text next month produced the same failure to match, and another duplicate
 * item, however many times somebody had already fixed it.
 *
 * Recording the misreading as a second wording for the same item closes that
 * loop: the correction is what teaches the app, and it only has to be made
 * once. Safe by construction — the wording is attached to the item the
 * submitter themselves chose, and findItemByDescription already refuses to
 * guess when two items claim the same wording, so a bad entry degrades into
 * "no match" rather than a wrong one.
 */
async function rememberMisreading(
  admin: SupabaseClient,
  {
    itemId,
    vendorId,
    description,
    originalDescription,
    userId,
  }: {
    itemId: string;
    vendorId: string;
    description: string;
    originalDescription: string | null;
    userId: string;
  }
): Promise<void> {
  if (!isWorthRemembering(originalDescription, description)) return;

  await recordVendorItemDescription(admin, {
    itemId,
    vendorId,
    description: originalDescription!.trim(),
    userId,
  });
}

/**
 * Whether a submitter's edit taught us a wording worth keeping.
 *
 * Separated out so the rule is testable without a database: everything else in
 * this module speaks the Supabase client's query API, which the in-process test
 * Postgres cannot answer.
 *
 * Compared after normalization, so re-casing or re-spacing a description — the
 * commonest kind of edit — does not fill the table with rows that all mean the
 * same thing and would never have failed to match anyway.
 */
export function isWorthRemembering(
  originalDescription: string | null | undefined,
  description: string
): boolean {
  const original = (originalDescription ?? "").trim();
  if (!original) return false;
  return normalize(original) !== normalize(description);
}

/**
 * What one unit of the auto-created pack size cost, from a receipt line.
 *
 * matchOrCreatePackSize always makes the plain "one unit" shape, so the price
 * that belongs on the offer is the price of a single unit — not the line
 * total, which is what quantity units cost together. Derived from the
 * normalized quantity in preference to the raw one because the pack size's
 * unit is the normalized one: a line reading "2000 g @ $0.004" normalizes to
 * 2 kg, and the offer wants $4.00/kg, not $0.004/g.
 *
 * Null rather than a number whenever the arithmetic would produce something
 * nobody should see on a pricelist: a credit or refund line (negative), a
 * quantity of zero, or a line whose quantity was never read.
 *
 * Kept pure and exported so the rule is testable without a database — the
 * rest of this module speaks the Supabase query API.
 */
/**
 * Put a receipt's price on an offer that has none, and leave any other alone.
 *
 * The guard is the whole point: pack_price is master data, and an offer that
 * already carries one carries it because somebody put it there. Filling only
 * the gaps means a receipt can complete a half-made offer — including every
 * offer created before prices were carried across at all — without a receipt
 * ever quietly restating an approved price.
 */
async function fillMissingPackPrice(
  admin: SupabaseClient,
  offerId: string,
  packPrice: number | null
): Promise<void> {
  if (packPrice == null) return;
  await admin
    .from("pricelist_items")
    .update({ pack_price: packPrice })
    .eq("id", offerId)
    .is("pack_price", null);
}

export function unitPriceFromLine({
  lineTotal,
  quantity,
  normalizedQuantity,
}: ReceiptLineFacts): number | null {
  const units = normalizedQuantity ?? quantity;
  if (units == null || !(units > 0)) return null;
  if (!(lineTotal > 0)) return null;
  return round4(lineTotal / units);
}

/** What a line says about how much was bought, and for what. */
export type ReceiptLineFacts = {
  lineTotal: number;
  quantity: number | null;
  normalizedQuantity: number | null;
  /** The unit that quantity is in, as extraction normalized it. */
  normalizedUnit?: string | null;
};

/** numeric(12, 4) — anything finer is lost on the way into the column. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The price to record against an offer, for the pack that offer is sold in.
 *
 * pack_price means the price of the whole pack, which is why this cannot just
 * be a per-unit figure: an offer whose pack is 5 kg × 4 and whose price is
 * $2.40 reads as 12 cents a kilo. So the price has to be worked out for
 * whichever pack was created alongside it.
 *
 * Two cases, decided by whether the line's own quantity is counted in the
 * pack's unit:
 *
 *   "Rice 5kg x 4", 20 kg for $48 — the quantity is in kilos, the same unit
 *   the pack is described in, so the pack costs its own contents' worth:
 *   $2.40/kg × 20 kg = $48.
 *
 *   "Ghee 12x500g", 1 for $60 — the quantity counts packs, not grams, so the
 *   line total divided by the number of packs is already the pack price.
 *
 * Null wherever the arithmetic would produce a figure nobody should see on a
 * pricelist — see unitPriceFromLine, whose refusals this inherits.
 */
export function offerPackPrice(line: ReceiptLineFacts, shape: PackShape | null): number | null {
  if (!shape) return unitPriceFromLine(line);

  const totalQuantity = shape.innerQuantity * shape.packCount;

  if (canonicalUnitCode(line.normalizedUnit) === shape.unitCode) {
    const perUnit = unitPriceFromLine(line);
    return perUnit == null ? null : round4(perUnit * totalQuantity);
  }

  const packs = line.quantity ?? 1;
  if (!(packs > 0) || !(line.lineTotal > 0)) return null;
  return round4(line.lineTotal / packs);
}

/**
 * The offer the submitter picked from the Pricelist typeahead.
 *
 * Matching normally reads the description text, which is the only evidence a
 * receipt gives. But the submit form has a typeahead that lists one suggestion
 * per approved offer, showing its pack and vendor — and the person choosing
 * from it is looking at the invoice. That is better evidence than the wording,
 * and until now it was thrown away: the choice set the category and nothing
 * else, so the server re-derived a pack from the text and could land somewhere
 * other than the pack that was picked.
 *
 * Returns null when the id does not resolve, so a stale pin — an offer deleted
 * between the page loading and the submission — falls back to matching rather
 * than failing the whole expense.
 *
 * Deliberately does not check the offer's vendor against the expense's. The
 * same product is bought from several vendors, and a submitter pinning the
 * pack they recognise from another vendor's offer is stating what was bought,
 * not who sold it. What that means for the vendor's own offer list is settled
 * below, the same way an unrecognised description would be.
 */
export async function chosenOffer(
  admin: SupabaseClient,
  {
    offerId,
    vendorId,
    description,
    originalDescription,
    userId,
    line,
    normalizedUnit,
  }: {
    offerId: string;
    vendorId: string;
    description: string;
    originalDescription: string | null;
    userId: string;
    line?: ReceiptLineFacts | null;
    normalizedUnit: string | null;
  }
): Promise<{ id: string; status: "matched"; categoryId: string | null } | null> {
  const { data: offer } = await admin
    .from("pricelist_items")
    .select("id, pack_size_id, item_pack_sizes ( items ( id, category_id ) )")
    .eq("id", offerId)
    .maybeSingle<{
      id: string;
      pack_size_id: string;
      item_pack_sizes: { items: { id: string; category_id: string | null } | null } | null;
    }>();
  if (!offer) return null;

  const item = offer.item_pack_sizes?.items ?? null;

  // The pack is already known, so the price is the price of that pack rather
  // than something derived from a shape read out of the wording.
  const shape = packShapeFromDescription(description);
  const packPrice = line ? offerPackPrice({ ...line, normalizedUnit }, shape) : null;
  await fillMissingPackPrice(admin, offer.id, packPrice);

  // A pin is also a person saying "this wording means this item", which is the
  // same lesson a correction teaches — worth keeping for the next receipt.
  if (item) {
    await recordVendorItemDescription(admin, { itemId: item.id, vendorId, description, userId });
    await rememberMisreading(admin, {
      itemId: item.id,
      vendorId,
      description,
      originalDescription,
      userId,
    });
  }

  return { id: offer.id, status: "matched", categoryId: item?.category_id ?? null };
}

export async function matchOrCreateOffer(
  admin: SupabaseClient,
  {
    vendorId,
    description,
    originalDescription = null,
    categoryId,
    userId,
    normalizedUnit = null,
    line = null,
  }: {
    vendorId: string;
    description: string;
    /**
     * What extraction read before the submitter corrected it, when they did.
     * Remembered alongside the corrected wording so the same misreading links
     * straight through next time instead of creating a duplicate item.
     */
    originalDescription?: string | null;
    categoryId: string | null;
    userId: string;
    normalizedUnit?: string | null;
    /**
     * What this line says was bought and for how much.
     *
     * Used for the offer's price, which every offer a receipt created used to
     * lack entirely — leaving somebody to type in a figure the receipt had
     * already stated. Worked out here rather than by the caller because the
     * right price depends on the pack this decides to create; see
     * offerPackPrice. An existing price is never overwritten: it is what a
     * person entered or approved, and one receipt is not grounds to replace
     * it.
     */
    line?: ReceiptLineFacts | null;
  }
): Promise<{ id: string; status: "matched" | "created"; categoryId: string | null }> {
  const shape = packShapeFromDescription(description);
  const packPrice = line ? offerPackPrice({ ...line, normalizedUnit }, shape) : null;
  const knownOffer = await findOfferByVendorDescription(admin, vendorId, description);
  if (knownOffer) {
    // Same reasoning as in matchOrCreateItem: this vendor's wording is already
    // tied to an item somebody categorised, so that category is the answer.
    const { data: known } = await admin
      .from("pricelist_items")
      .select("item_pack_sizes ( items ( id, category_id ) )")
      .eq("id", knownOffer)
      .single<{
        item_pack_sizes: { items: { id: string; category_id: string | null } | null } | null;
      }>();
    const matchedItem = known?.item_pack_sizes?.items ?? null;

    if (matchedItem) {
      await rememberMisreading(admin, {
        itemId: matchedItem.id,
        vendorId,
        description,
        originalDescription,
        userId,
      });
    }

    await fillMissingPackPrice(admin, knownOffer, packPrice);
    return { id: knownOffer, status: "matched", categoryId: matchedItem?.category_id ?? null };
  }

  const item = await matchOrCreateItem(admin, { description, categoryId, normalizedUnit, userId });

  const { data: itemRow } = await admin.from("items").select("canonical_unit_id").eq("id", item.id).single();
  const packSizeId = await matchOrCreatePackSize(admin, {
    itemId: item.id,
    canonicalUnitId: itemRow!.canonical_unit_id,
    normalizedUnit,
    description,
  });

  await recordVendorItemDescription(admin, { itemId: item.id, vendorId, description, userId });
  await rememberMisreading(admin, {
    itemId: item.id,
    vendorId,
    description,
    originalDescription,
    userId,
  });

  const { data: byVendor } = await admin
    .from("pricelist_items")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("pack_size_id", packSizeId)
    .maybeSingle();
  if (byVendor) {
    await fillMissingPackPrice(admin, byVendor.id, packPrice);
    return { id: byVendor.id, status: "matched", categoryId: item.categoryId };
  }

  const { data: created, error } = await admin
    .from("pricelist_items")
    .insert({
      vendor_id: vendorId,
      pack_size_id: packSizeId,
      pack_price: packPrice,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, status: "created", categoryId: item.categoryId };
}
