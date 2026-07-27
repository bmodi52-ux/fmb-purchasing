import Anthropic from "@anthropic-ai/sdk";

export type ExtractedLineItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  category: string;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  gstApplicable: boolean;
};

export type ExtractedReceipt = {
  vendor: string | null;
  abn: string | null;
  date: string | null;
  invoiceNumber: string | null;
  lineItems: ExtractedLineItem[];
  subtotal: number | null;
  gstAmount: number | null;
  total: number | null;
};

const EXTRACT_TOOL_NAME = "record_receipt";

function buildTool(categoryNames: string[]): Anthropic.Tool {
  return {
    name: EXTRACT_TOOL_NAME,
    description: "Records structured data extracted from a receipt or invoice photo/PDF.",
    input_schema: {
      type: "object",
      properties: {
        vendor: { type: ["string", "null"], description: "Business name printed on the receipt." },
        abn: {
          type: ["string", "null"],
          description: "Australian Business Number, 11 digits, no spaces. Null if not printed.",
        },
        date: { type: ["string", "null"], description: "Receipt date, as printed." },
        invoiceNumber: { type: ["string", "null"] },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: ["number", "null"] },
              unitPrice: { type: ["number", "null"] },
              lineTotal: { type: ["number", "null"] },
              category: {
                type: "string",
                enum: categoryNames,
                description: "Best-fit category from the provided list.",
              },
              normalizedQuantity: {
                type: ["number", "null"],
                description:
                  "Total quantity in the canonical base unit, deduced from pack description. E.g. 'Tomato Sauce Carton — 3x4L' -> 12.",
              },
              normalizedUnit: {
                type: ["string", "null"],
                description: "Canonical base unit for normalizedQuantity, e.g. 'kg', 'L', 'unit'.",
              },
              gstApplicable: {
                type: "boolean",
                description: "Whether GST applies to this line, inferred from the receipt.",
              },
            },
            required: ["description", "category", "gstApplicable"],
          },
        },
        subtotal: { type: ["number", "null"], description: "Total excluding GST." },
        gstAmount: { type: ["number", "null"] },
        total: { type: ["number", "null"], description: "Total including GST." },
      },
      required: ["lineItems"],
    },
  };
}

const SYSTEM_PROMPT = `You extract structured accounting data from photos or PDFs of receipts/invoices for an Australian organization that is GST-registered and reconciles GST at year end.

Rules:
- Every receipt must resolve to Subtotal (excl. GST) -> GST amount -> Total (incl. GST). Infer GST from whatever the receipt makes inferable (an explicit GST line, "Total incl. GST", a registered ABN printed on a tax invoice, etc.). If the receipt gives no GST signal at all — no GST line, and nothing indicating whether printed prices are GST-inclusive or GST-free — do NOT assume GST-free. Assume all printed prices are GST-inclusive (standard 10% Australian GST): set total to the printed total, then compute gstAmount = total / 11 and subtotal = total - gstAmount.
- For each line item, infer the canonical base unit and total quantity from the printed pack description (e.g. "Tomato Sauce Carton — 3x4L" -> normalizedQuantity 12, normalizedUnit "L"; "Chicken 10kg box" -> normalizedQuantity 10, normalizedUnit "kg"). If no sensible unit conversion applies (e.g. a service line), leave both null.
- Assign each line item the closest category from the provided enum. Use "Miscellaneous" only when nothing else fits.
- Strip currency symbols from numbers. If a value is unreadable or absent, use null rather than guessing.
- Call the record_receipt tool exactly once with everything you found.`;

export async function extractReceipt(
  fileBase64: string,
  mediaType: string,
  categoryNames: string[]
): Promise<ExtractedReceipt> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const isPdf = mediaType === "application/pdf";
  const contentBlock: Anthropic.ContentBlockParam = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
          data: fileBase64,
        },
      };

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [buildTool(categoryNames)],
    tool_choice: { type: "tool", name: EXTRACT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [contentBlock, { type: "text", text: "Extract this receipt." }],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) throw new Error("Claude did not return structured data for this receipt.");

  const raw = toolUse.input as Record<string, unknown>;
  return {
    vendor: (raw.vendor as string) ?? null,
    abn: (raw.abn as string) ?? null,
    date: (raw.date as string) ?? null,
    invoiceNumber: (raw.invoiceNumber as string) ?? null,
    subtotal: (raw.subtotal as number) ?? null,
    gstAmount: (raw.gstAmount as number) ?? null,
    total: (raw.total as number) ?? null,
    lineItems: ((raw.lineItems as ExtractedLineItem[]) ?? []).map((item) => ({
      description: item.description ?? "",
      quantity: item.quantity ?? null,
      unitPrice: item.unitPrice ?? null,
      lineTotal: item.lineTotal ?? null,
      category: item.category ?? "Miscellaneous",
      normalizedQuantity: item.normalizedQuantity ?? null,
      normalizedUnit: item.normalizedUnit ?? null,
      gstApplicable: item.gstApplicable ?? false,
    })),
  };
}
