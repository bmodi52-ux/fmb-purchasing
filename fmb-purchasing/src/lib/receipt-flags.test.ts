import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { receiptFlags, type ReceiptFlagLine } from "./receipt-flags";

const line = (description: string, lineTotal: number, note?: string): ReceiptFlagLine => ({
  description,
  lineTotal,
  notOnReceipt: note !== undefined,
  notOnReceiptNote: note ?? null,
});

describe("receiptFlags (#51)", () => {
  test("the Fresh Poultry claim: $150 on top of the receipt, with its reason", () => {
    const flags = receiptFlags({
      receiptTotal: 990,
      receiptTotalScanned: 990,
      receiptTotalNote: null,
      lines: [line("Chicken Whole", 990), line("Clean and cut", 150, "cutting charge, paid in cash")],
    });
    assert.deepEqual(flags, [
      { label: "$150.00 of this claim isn't on the receipt: Clean and cut (cutting charge, paid in cash)", serious: true },
    ]);
  });

  test("a scanned total typed up to make the sums work shows as exactly that", () => {
    const flags = receiptFlags({
      receiptTotal: 1140,
      receiptTotalScanned: 990,
      receiptTotalNote: "added the cutting",
      lines: [line("Chicken Whole", 990), line("Clean and cut", 150)],
    });
    assert.equal(flags.length, 1);
    assert.match(flags[0].label, /read as \$990\.00, changed to \$1,140\.00 — added the cutting/);
  });

  test("a difference nobody explained is shown with both figures", () => {
    const flags = receiptFlags({
      receiptTotal: 2737,
      receiptTotalScanned: 2737,
      receiptTotalNote: null,
      lines: [line("Okra", 2717)],
    });
    assert.equal(flags.length, 1);
    assert.match(flags[0].label, /Unexplained difference of \$20\.00: the receipt says \$2,737\.00, the lines on it come to \$2,717\.00/);
  });

  test("a claim that matches its receipt raises nothing, nor does one from before 0060", () => {
    assert.deepEqual(
      receiptFlags({ receiptTotal: 50, receiptTotalScanned: 50, receiptTotalNote: null, lines: [line("Milk", 50)] }),
      []
    );
    assert.deepEqual(
      receiptFlags({ receiptTotal: null, receiptTotalScanned: null, receiptTotalNote: null, lines: [line("Milk", 10)] }),
      []
    );
  });
});
