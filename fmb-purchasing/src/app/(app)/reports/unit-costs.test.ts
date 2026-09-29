import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { averageUnitCosts, perUnitRows, perUnitVendorSeries } from "./unit-costs.ts";
import type { ExpenseRecord, Slice } from "@/lib/reporting/aggregate.ts";
import type { PaidCostRow } from "@/lib/reporting/ledger-rows.ts";

// Asserted rather than annotated so it type-checks both before and after
// ExpenseRecord gains reportDate (0083).
const expense = (id: string, vendorName: string, reportDate: string) =>
  ({
    id,
    expenseNumber: id,
    vendorId: vendorName,
    vendorName,
    status: "approved",
    receiptDate: reportDate,
    createdAt: `${reportDate}T01:00:00Z`,
    reportDate,
    total: 0,
    gst: 0,
  }) as ExpenseRecord;

/** A purchase of `kilos` kilos of chicken for `paid`, in packs of `packKg`. */
const chicken = (expenseId: string, kilos: number, paid: number, extra: Partial<PaidCostRow> = {}): PaidCostRow => ({
  item_id: "chicken",
  item_name: "Chicken",
  expense_id: expenseId,
  receipt_date: null,
  base_quantity: kilos,
  base_unit_code: "kg",
  cost_per_base_unit: Math.round((paid / kilos) * 10000) / 10000,
  line_total: paid,
  normalized_quantity: 1,
  sold_loose: false,
  pack_disagrees: false,
  ...extra,
});

const slice: Slice = {
  expenses: [expense("big", "Fresh Poultry", "2026-08-01"), expense("small", "Corner Shop", "2026-08-03"), expense("odd", "Fresh Poultry", "2026-08-05")],
  lines: [],
};

const costs: PaidCostRow[] = [
  // 40 kg for $280 — $7/kg — and a 1 kg top-up for $12.
  chicken("big", 40, 280, { receipt_date: "2026-08-01" }),
  chicken("small", 1, 12, { receipt_date: "2026-08-03" }),
  // A pack recorded as 1 kg that the receipt says was 20: $180/kg on paper.
  chicken("odd", 1, 180, { receipt_date: "2026-08-05", pack_disagrees: true }),
  // Outside the slice.
  chicken("elsewhere", 10, 10),
];

describe("averageUnitCosts", () => {
  const avg = averageUnitCosts(costs, slice, () => true).get("chicken")!;

  test("is what was paid over what was bought, so a big order counts for more", () => {
    // (280 + 12) / 41 kg = $7.12/kg. The plain mean of $7 and $12 would be $9.50.
    assert.equal(Math.round(avg.average * 100) / 100, 7.12);
    assert.equal(avg.unit, "kg");
  });

  test("leaves out a purchase whose pack is in doubt", () => {
    assert.equal(avg.purchases, 2);
  });

  test("only counts purchases in the slice", () => {
    assert.equal(averageUnitCosts(costs, { expenses: [], lines: [] }, () => true).size, 0);
  });

  test("respects the item filter", () => {
    assert.equal(averageUnitCosts(costs, slice, (id) => id !== "chicken").size, 0);
  });

  test("an item whose every purchase is disputed has no average, as on the Pricelist", () => {
    assert.equal(averageUnitCosts([costs[2]], slice, () => true).size, 0);
  });
});

describe("perUnitRows", () => {
  const rows = perUnitRows(costs, slice, () => true);

  test("lists every purchase in the slice, disputed ones marked rather than dropped", () => {
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.disputed), [false, false, true]);
  });

  test("takes the vendor from the expense", () => {
    assert.deepEqual(rows.map((r) => r.vendorName), ["Fresh Poultry", "Corner Shop", "Fresh Poultry"]);
  });

  test("a figure cached before pack_disagrees was read counts as believed", () => {
    const { pack_disagrees, ...old } = costs[0];
    void pack_disagrees;
    assert.equal(perUnitRows([old], slice, () => true)[0].disputed, false);
  });
});

describe("perUnitVendorSeries", () => {
  test("keeps disputed purchases off the trend", () => {
    const series = perUnitVendorSeries(perUnitRows(costs, slice, () => true));
    const fresh = series.find((s) => s.name === "Fresh Poultry")!;
    assert.deepEqual(fresh.points.map((p) => p.x), ["2026-08-01"]);
  });
});
