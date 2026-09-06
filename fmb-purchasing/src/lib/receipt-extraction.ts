import Anthropic from "@anthropic-ai/sdk";

/**
 * What a line represents. Only `goods` carries a unit cost and belongs in
 * price analytics; everything else exists so that the lines add up to the
 * total printed on the receipt. Mirrors the `line_item_kind` enum in
 * migration 0026 — keep the two in step.
 */
export const LINE_KINDS = [
  "goods",
  "surcharge",
  "delivery",
  "discount",
  "rounding",
  "deposit",
] as const;

export type LineKind = (typeof LINE_KINDS)[number];

/**
 * Every kind a stored line can have. `unallocated` is deliberately absent from
 * the enum offered to the model: it is not something a receipt says, it is what
 * the app records when the lines it read do not account for the total and the
 * shortfall is too large to be a charge — see residualFor in expense-money.
 */
export type StoredLineKind = LineKind | "unallocated";

export type ExtractedLineItem = {
  description: string;
  kind: LineKind;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  /**
   * Leaf category name, or null when the line is too vague to classify. Null
   * is a real answer here rather than a failure — see UNCLEAR_CATEGORY.
   */
  category: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  /**
   * Whether GST applies to this line, read from the receipt.
   *
   * Stored per line since 0026. It used to be inferred here and then
   * discarded, with line GST re-derived as a share of the receipt total —
   * which spread GST across GST-free food on any receipt that mixed the two.
   */
  gstApplicable: boolean;
};

/**
 * Who the covering message says to pay, when the upload is a forwarded email
 * rather than a bare receipt.
 *
 * These uploads are deliberate — someone attaches the email because the
 * instruction lives in it, not in the receipt. That instruction is routinely
 * the only record of who is owed the money ("Please pay Miqdad Bhai", "pay
 * Taj Mart directly"), and sometimes the only record of the amount, when
 * there is no receipt at all.
 */
export type ExtractedPayee = {
  name: string | null;
  bankAccountName: string | null;
  bsb: string | null;
  accountNumber: string | null;
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
  payee: ExtractedPayee | null;
  /** Anything the reader should know that the fields above cannot hold. */
  note: string | null;
};

const EXTRACT_TOOL_NAME = "record_receipt";

/**
 * The model, and how hard it is asked to think.
 *
 * Sonnet 5 rather than Opus 5, on the specific shape of this task.
 *
 * Measured on this organisation's own receipts, one extraction is roughly
 * 2,950 input and 225 output tokens. At 1,000 submissions a month the two
 * models land within a few dollars of each other once the image is priced —
 * Sonnet 5's higher-resolution vision costs more input tokens at a lower rate
 * per token — so cost is not what decides this.
 *
 * What decides it is where the errors come from. These receipts fail on being
 * *read*, not on being reasoned about: faded thermal paper, a wholesale
 * invoice photographed sideways at sixteen rows of small type, "URID GOTA
 * 1KG" written across a receipt in ballpoint because the printed line says
 * only "OPEN ITEM". Sonnet 5 sees at 2576px against the standard 1568px cap.
 * More pixels on the page beats more thinking about a blurrier one.
 *
 * Effort, not model, is the knob to tune from a comparison run — see
 * scripts/compare-extraction.mjs. Medium rather than low because the GST
 * judgement is real work; thinking is left adaptive because disabling it can
 * push a tool call into visible text, which would surface here as "no
 * structured data" on a receipt the model had actually read.
 */
const MODEL = "claude-sonnet-5";
const EFFORT = "medium";

/**
 * Generous enough that a long wholesale invoice cannot be truncated.
 *
 * This was 2048, which a receipt of about fifteen lines would exhaust — the
 * Campbells invoice in the sample set has sixteen, before the charge lines
 * that 0026 now adds on top. Nothing checked for truncation either, so the
 * failure looked like malformed output rather than a cut-off response.
 *
 * Costs nothing to raise: billing is on tokens actually produced, and this is
 * only a ceiling.
 */
const MAX_TOKENS = 16000;

/**
 * Milliseconds. The SDK retries 408/409/429/5xx and connection errors.
 *
 * Three minutes, not the ninety seconds this started at. A comparison run over
 * the real receipt folder timed out twice on multi-page PDFs and had another
 * finish at 86s, so the original ceiling was cutting off work that was still
 * going to succeed — and a timeout here costs the submitter the whole upload.
 */
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 2;

/**
 * How the model says "this line does not tell me enough to classify it".
 *
 * There was previously no way to say that. The enum held only real categories
 * and the prompt sent anything unmatched to "Miscellaneous", so a line reading
 * "Sundries" or "Item 4" came back looking as decided as any other, the item
 * was filed under Miscellaneous, and nothing ever suggested a person should
 * look at it.
 *
 * The two mean opposite things and are worth keeping apart: Miscellaneous is a
 * decision — this spend belongs to no other category — while this is the
 * absence of one. It maps to a null category, which leaves the item
 * uncategorised and listed as needing attention on the Pricelist.
 */
export const UNCLEAR_CATEGORY = "Unclear — needs a person";

function buildTool(categoryNames: string[]): Anthropic.Tool {
  return {
    name: EXTRACT_TOOL_NAME,
    description: "Records structured data extracted from a receipt, invoice, or covering email.",
    // Guarantees the returned input validates against this schema exactly.
    //
    // It matters most for `category`. Without it the enum is a suggestion, and
    // a plausible near-miss — "Produce" for "Produce (Fruit & Vegetables)" —
    // fails the name lookup in submit/actions.ts, falls through `?? null`, and
    // lands as an uncategorised line indistinguishable from a genuine
    // "unclear" answer. That would quietly undo the whole point of having a
    // way to say "unclear".
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        vendor: { type: ["string", "null"], description: "Business name printed on the receipt." },
        abn: {
          type: ["string", "null"],
          description: "Australian Business Number, 11 digits, no spaces. Null if not printed.",
        },
        date: {
          type: ["string", "null"],
          description:
            "Receipt date as YYYY-MM-DD. Australian receipts print DD/MM/YYYY, so 02/07/2026 " +
            "is 2 July 2026 and must be returned as 2026-07-02. Convert it; do not transcribe " +
            "what is printed. If the document carries more than one date, use the invoice or " +
            "purchase date, not a delivery or payment date.",
        },
        invoiceNumber: { type: ["string", "null"] },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              description: { type: "string" },
              kind: {
                type: "string",
                enum: [...LINE_KINDS],
                description:
                  "What this line is. 'goods' for something bought; the others for amounts the " +
                  "receipt charges or credits without them being a purchase.",
              },
              quantity: { type: ["number", "null"] },
              unitPrice: { type: ["number", "null"] },
              lineTotal: { type: ["number", "null"] },
              category: {
                type: "string",
                enum: [...categoryNames, UNCLEAR_CATEGORY],
                description:
                  "Best-fit category for this line, or the 'Unclear' option when the line text does not say enough to choose one.",
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
            required: [
              "description",
              "kind",
              "quantity",
              "unitPrice",
              "lineTotal",
              "category",
              "normalizedQuantity",
              "normalizedUnit",
              "gstApplicable",
            ],
          },
        },
        subtotal: { type: ["number", "null"], description: "Total excluding GST." },
        gstAmount: { type: ["number", "null"] },
        total: { type: ["number", "null"], description: "Total including GST." },
        payee: {
          type: ["object", "null"],
          additionalProperties: false,
          description:
            "Who a covering email says to pay. Null when the upload is just a receipt with no such instruction.",
          properties: {
            name: { type: ["string", "null"] },
            bankAccountName: { type: ["string", "null"] },
            bsb: { type: ["string", "null"], description: "Australian BSB, digits only." },
            accountNumber: { type: ["string", "null"] },
          },
          required: ["name", "bankAccountName", "bsb", "accountNumber"],
        },
        note: {
          type: ["string", "null"],
          description:
            "Anything a reviewer should know that no other field holds — a handwritten annotation, " +
            "an instruction in the covering email, an explanation of why the figures look unusual.",
        },
      },
      required: [
        "vendor",
        "abn",
        "date",
        "invoiceNumber",
        "lineItems",
        "subtotal",
        "gstAmount",
        "total",
        "payee",
        "note",
      ],
    },
  };
}

const SYSTEM_PROMPT = `You extract structured accounting data from photos or PDFs of receipts/invoices for an Australian organization that is GST-registered and reconciles GST at year end. It is a community kitchen: most of what it buys is food.

WHAT YOU MAY BE GIVEN
- A photo of a receipt or invoice.
- A PDF of one, sometimes scanned or photographed.
- A forwarded email, printed to PDF, whose body carries the instruction and whose later pages may hold the receipt. Read the whole document. The covering message is not noise — it is attached deliberately, because it says something the receipt does not: who to reimburse, what the payment is for, or the amount itself when there is no receipt at all. Extract from both the message and any receipt it carries.
- Occasionally an email with no receipt whatsoever, just someone stating what they paid. Record what it says and set the fields the message does not support to null.

HANDWRITING MATTERS
Read handwritten annotations as carefully as printed text, and treat them as authoritative about what was bought. Many receipts here identify a line only as "OPEN ITEM", "GROCERY ITEM" or "OPEN FRESH MEAT", and the person who did the shopping has written the real product beside it in pen. That handwriting is often the only record of what the money was spent on: use it for the line's description, and put anything else handwritten on the receipt into "note".

GST — READ IT, DO NOT ASSUME IT
Every receipt must resolve to Subtotal (excl. GST) -> GST amount -> Total (incl. GST), and each line must say whether GST applies to it.
- Prefer what the receipt states. Receipts mark this in various ways: an explicit GST column or total, an asterisk or letter flag against taxable lines, a footnote such as "(*) denotes items which attract GST".
- Most basic food in Australia is GST-free: fresh meat, poultry, fish, fruit, vegetables, plain milk, eggs, flour, rice, plain bread, cooking oil, spices. A tax invoice reading "GST $0.00" on a large grocery or meat purchase is normal and correct — record the zero, do not overrule it.
- Prepared food, soft drinks, confectionery, and non-food items — disposables, cleaning products, equipment — normally DO carry GST. So do card surcharges, delivery and service fees.
- If the receipt gives no GST signal at all, decide per line from what the line is: GST-free for basic food, GST-inclusive at 10% for anything else. Do NOT apply a blanket 10% to a receipt full of fresh food; a claimed credit that does not exist is a worse error than a missed one.
- Set gstAmount to the total GST across the receipt, consistent with the per-line flags. If the receipt prints a GST total, use the printed figure.

EVERY DOLLAR OF THE TOTAL MUST APPEAR ON A LINE
The line items must add up to the total printed on the receipt. When a receipt charges or credits something that is not a purchase, record it as its own line with the right kind:
- surcharge — card surcharge, service fee ("CREDIT SURCHARGE 0.56", "TOTAL SURCHARGE 0.50%")
- delivery — freight, delivery, fuel levy
- discount — always a negative amount ("10 % DISCOUNT ... 9.20-")
- rounding — Australian 5c cash rounding, either sign
- deposit — crate or container deposit, and its refund as a negative
Do not fold these into a goods line and do not leave them out. A genuine credit or return of goods stays kind "goods" with a negative amount.

OTHER RULES
- For each goods line, infer the canonical base unit and total quantity from the printed pack description (e.g. "Tomato Sauce Carton — 3x4L" -> normalizedQuantity 12, normalizedUnit "L"; "Chicken 10kg box" -> normalizedQuantity 10, normalizedUnit "kg"). Leave both null when no sensible conversion applies, and on any line that is not goods.
- Assign each line the closest category from the provided enum. "Miscellaneous" is a real choice meaning the spend genuinely belongs to no other category — a one-off fee, a sundry charge. It is NOT a way of saying you are unsure.
- When the line text does not say enough to classify it — "Sundries", "Item 4", an illegible or truncated description with no handwriting to clarify it — choose the "Unclear" option instead of guessing. An unclear line is put in front of a person to decide, which is far better than a confident wrong category nobody ever revisits.
- Strip currency symbols from numbers. If a value is unreadable or absent, use null rather than guessing.
- Return the date as YYYY-MM-DD. Receipts here are Australian and print day first, so 02/07/2026 means 2 July 2026 and must come back as 2026-07-02, never 2026-02-07.
- Call the record_receipt tool exactly once with everything you found.`;

/**
 * One client, reused across calls, so the connection pool and retry policy are
 * not rebuilt per receipt.
 *
 * A hung request used to block the server action until the platform killed it,
 * with nothing shown to the submitter in the meantime.
 */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }
  return client;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toKind(value: unknown): LineKind {
  return (LINE_KINDS as readonly string[]).includes(value as string) ? (value as LineKind) : "goods";
}

/**
 * Overrides used only by the comparison harness
 * (scripts/compare-extraction.mjs), so that a model or effort sweep runs
 * against this exact prompt and tool schema rather than a copy of them that
 * would drift the moment either changed.
 */
export type ExtractOptions = {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export type ExtractDetail = {
  receipt: ExtractedReceipt;
  model: string;
  effort: string;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  elapsedMs: number;
};

export async function extractReceipt(
  fileBase64: string,
  mediaType: string,
  categoryNames: string[],
  options?: ExtractOptions
): Promise<ExtractedReceipt> {
  return (await extractReceiptDetailed(fileBase64, mediaType, categoryNames, options)).receipt;
}

/**
 * The extraction call, with everything the harness needs to score and cost it.
 * The app itself only wants the receipt, and uses {@link extractReceipt}.
 */
export async function extractReceiptDetailed(
  fileBase64: string,
  mediaType: string,
  categoryNames: string[],
  options?: ExtractOptions
): Promise<ExtractDetail> {
  const model = options?.model ?? MODEL;
  const effort = options?.effort ?? EFFORT;
  const startedAt = Date.now();
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

  const response = await getClient().messages.create({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort },
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

  // A truncated response can still carry a partial tool_use block, which would
  // parse into a receipt that is quietly missing its last few lines — the one
  // failure mode that produces plausible wrong numbers rather than an error.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The receipt was too long to read in one pass — it was cut off partway through. " +
        "Try photographing it in sections, or enter it manually."
    );
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to read this file.");
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) throw new Error("Claude did not return structured data for this receipt.");

  // `strict: true` guarantees this conforms to the schema, so the guards below
  // are belt-and-braces rather than the only line of defence they used to be.
  const raw = toolUse.input as Record<string, unknown>;
  const rawPayee = raw.payee as Record<string, unknown> | null | undefined;
  const payee: ExtractedPayee | null = rawPayee
    ? {
        name: str(rawPayee.name),
        bankAccountName: str(rawPayee.bankAccountName),
        bsb: str(rawPayee.bsb),
        accountNumber: str(rawPayee.accountNumber),
      }
    : null;

  const receipt: ExtractedReceipt = {
    vendor: str(raw.vendor),
    abn: str(raw.abn),
    date: str(raw.date),
    invoiceNumber: str(raw.invoiceNumber),
    subtotal: num(raw.subtotal),
    gstAmount: num(raw.gstAmount),
    total: num(raw.total),
    note: str(raw.note),
    // A payee object whose every field came back null says nothing.
    payee: payee && Object.values(payee).some((v) => v !== null) ? payee : null,
    lineItems: ((raw.lineItems as Record<string, unknown>[]) ?? [])
      // A charge of nothing is not a charge. Real receipts print waived fees —
      // one DoorDash order in the sample set carried "Delivery Fee $0.00" and
      // "Dasher Tip $0.00" — and carrying those through would add rows to the
      // review table that hold no money and mean nothing. Goods are kept at
      // zero, because a zero-priced good is a real thing worth seeing.
      .filter((item) => {
        const kind = toKind(item.kind);
        return kind === "goods" || num(item.lineTotal) !== 0;
      })
      .map((item) => ({
      description: str(item.description) ?? "",
      kind: toKind(item.kind),
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      lineTotal: num(item.lineTotal),
      // The sentinel and a missing value both mean nobody has classified this,
      // which downstream is a null category rather than a guess.
      category:
        !item.category || item.category === UNCLEAR_CATEGORY ? null : (item.category as string),
      normalizedQuantity: num(item.normalizedQuantity),
      normalizedUnit: str(item.normalizedUnit),
      gstApplicable: item.gstApplicable === true,
    })),
  };

  return {
    receipt,
    model,
    effort,
    stopReason: response.stop_reason ?? null,
    usage: {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
    elapsedMs: Date.now() - startedAt,
  };
}
