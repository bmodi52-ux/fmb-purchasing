import Anthropic from "@anthropic-ai/sdk";
import { PACKAGING, type Packaging } from "@/lib/pack-description";

/**
 * Reading products off photos taken in a shop — a shelf price tag, the
 * product's own label, or both — or off a supplier's price list.
 *
 * The companion of receipt-extraction: that reads what was bought, this reads
 * what something costs and how it is packed, so the Pricelist can be filled in
 * by pointing a phone at a shelf instead of by typing. It asks the model for
 * the answers in the shape a person would give them — what it is, what it
 * comes in, how much is in it, what it costs — and the app turns those into
 * items, pack sizes and prices behind the scenes.
 */

export const PRODUCT_UNITS = ["kg", "g", "L", "mL", "each"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export type ExtractedProduct = {
  /** What the kitchen would call it: short, generic, no brand or size — "Basmati Rice". */
  name: string;
  brand: string | null;
  /** The full name as printed, brand and size included — remembered for matching receipts later. */
  printedName: string | null;
  /** What one unit bought comes in, or loose. Null when the photo doesn't say. */
  soldAs: Packaging | "loose" | null;
  /** How much one of the things in the pack holds — the 10 in "10kg". */
  innerQuantity: number | null;
  unit: ProductUnit | null;
  /** How many of those are bought together — 10 for a carton of 10 × 1 L. */
  packCount: number | null;
  price: number | null;
  /** Whether the price is for the whole pack, or per kg / L / each. */
  priceIsPer: "pack" | "unit" | null;
  category: string | null;
};

export type ProductPhotoReading = {
  /** The shop or supplier, when a tag or price list shows it. */
  store: string | null;
  products: ExtractedProduct[];
  note: string | null;
};

const TOOL_NAME = "record_products";

/**
 * Same model as receipts, for the same reason — small print photographed at an
 * angle is a reading problem — but low effort: a shelf tag is a handful of
 * fields, and this is meant to be done in the few seconds someone stands at a
 * shelf.
 */
const MODEL = "claude-sonnet-5";
const EFFORT = "low";
const MAX_TOKENS = 16000;
const REQUEST_TIMEOUT_MS = 120_000;

export const UNCLEAR_PRODUCT_CATEGORY = "Unclear — needs a person";

function buildTool(categoryNames: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description:
      "Records the products, sizes and prices shown in photos of shelf tags, product labels, or a supplier's price list.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        store: {
          type: ["string", "null"],
          description: "The shop or supplier these are from, when it is shown. Null if not shown.",
        },
        products: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description:
                  "What a kitchen would call it on its own price list: short, generic, singular, title case, with no brand, size or packaging — 'Basmati Rice', 'Tomato', 'Chicken Thigh Fillet'.",
              },
              brand: { type: ["string", "null"] },
              printedName: {
                type: ["string", "null"],
                description: "The product's full name exactly as printed, brand and size included.",
              },
              soldAs: {
                type: "string",
                enum: [...PACKAGING, "loose", "unclear"],
                description:
                  "What one unit bought comes in, or 'loose' when it is priced by weight or each with no packaging.",
              },
              innerQuantity: {
                type: ["number", "null"],
                description:
                  "How much one of the things in the pack holds, as printed: '10kg' -> 10; '500g' -> 500; a tray of 30 eggs -> 30. For loose goods, 1.",
              },
              unit: {
                type: "string",
                enum: [...PRODUCT_UNITS, "unclear"],
                description: "The unit innerQuantity is in. 'each' for things counted rather than weighed.",
              },
              packCount: {
                type: ["number", "null"],
                description:
                  "How many of those are bought together: 1 for a single bag, 10 for a carton of 10 x 1L. 1 when not stated.",
              },
              price: {
                type: ["number", "null"],
                description:
                  "The price of one pack as bought — the main price on a tag, not its small unit price. For loose goods, the price per kg or each. Null if no price is visible.",
              },
              priceIsPer: {
                type: "string",
                enum: ["pack", "unit", "unclear"],
                description:
                  "'pack' when price is for the whole pack; 'unit' when it is per kg, per L or each.",
              },
              category: { type: "string", enum: [...categoryNames, UNCLEAR_PRODUCT_CATEGORY] },
            },
            required: [
              "name",
              "brand",
              "printedName",
              "soldAs",
              "innerQuantity",
              "unit",
              "packCount",
              "price",
              "priceIsPer",
              "category",
            ],
          },
        },
        note: {
          type: ["string", "null"],
          description: "Anything worth knowing that the fields cannot hold — a special, a limit, an unreadable price.",
        },
      },
      required: ["store", "products", "note"],
    },
  };
}

const SYSTEM_PROMPT = `You read photos taken in shops, and supplier price lists, for a community kitchen in Australia that keeps a price list of what it buys.

WHAT YOU MAY BE GIVEN
- A shelf price tag, a product's own label or packaging, or both, of one product. When a tag and a label are both given they are the same product: take the price from the tag, and the size and brand from the label.
- A supplier's price list, catalogue page or order sheet, photographed or as a PDF, listing many products. Record every product that has a price.

FOR EACH PRODUCT
- name: what the kitchen would call it — short and generic, with no brand, size or packaging. "Tilda Pure Basmati Rice 10kg" is "Basmati Rice". "Coles Truss Tomatoes per kg" is "Tomato".
- soldAs: what one unit bought comes in: box, bag, sack, carton, tray, punnet, bunch, bottle, jar, tin, tub or pack. Use "loose" for produce, meat or deli goods priced by weight or each with no packaging. Use "unclear" when you cannot tell.
- innerQuantity and unit: how much one of the things holds, as printed on the label or tag. For a carton of 10 x 1L bottles that is 1 L with packCount 10. For loose goods use 1 and the unit they are priced by.
- price: the price to pay for one pack as bought. Australian shelf tags print a small unit price such as "$2.40 per 1kg" beside the main price — that is a comparison figure. Use it to check the size, never as the price of a pack, unless it is the only price shown (then set priceIsPer "unit").
- category: the closest from the list, or the Unclear option when the photo does not say enough.
- Use null or "unclear" whenever something is not visible. Never invent a price or a size.

Call the record_products tool exactly once.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
  }
  return client;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function block(file: { base64: string; mediaType: string }): Anthropic.ContentBlockParam {
  return file.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: file.mediaType as "image/jpeg" | "image/png" | "image/webp",
          data: file.base64,
        },
      };
}

export async function extractProducts(
  files: { base64: string; mediaType: string }[],
  categoryNames: string[]
): Promise<ProductPhotoReading> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    system: SYSTEM_PROMPT,
    tools: [buildTool(categoryNames)],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          ...files.map(block),
          {
            type: "text",
            text:
              files.length > 1
                ? "These were taken together. Record the products they show."
                : "Record the products this shows.",
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error("That list was too long to read in one go. Try photographing it a page at a time.");
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined to read this photo.");

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("The photo could not be read.");

  const raw = toolUse.input as Record<string, unknown>;
  const products = ((raw.products as Record<string, unknown>[]) ?? [])
    .map((p): ExtractedProduct | null => {
      const name = str(p.name);
      if (!name) return null;
      const soldAs = p.soldAs === "unclear" ? null : ((p.soldAs as Packaging | "loose" | undefined) ?? null);
      const unit = (PRODUCT_UNITS as readonly string[]).includes(p.unit as string) ? (p.unit as ProductUnit) : null;
      return {
        name,
        brand: str(p.brand),
        printedName: str(p.printedName),
        soldAs,
        innerQuantity: positive(p.innerQuantity),
        unit,
        packCount: positive(p.packCount),
        price: positive(p.price),
        priceIsPer: p.priceIsPer === "pack" || p.priceIsPer === "unit" ? p.priceIsPer : null,
        category: !p.category || p.category === UNCLEAR_PRODUCT_CATEGORY ? null : (p.category as string),
      };
    })
    .filter((p): p is ExtractedProduct => p !== null);

  return { store: str(raw.store), products, note: str(raw.note) };
}
