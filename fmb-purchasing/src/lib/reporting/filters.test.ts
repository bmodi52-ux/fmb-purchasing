import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { narrowBudgetRows } from "./budget-view.ts";
import { describeSelection, offered, optionsOf, standardFilters, vendorKey } from "./filters.ts";
import { moneyOutViewFrom } from "./money-out-view.ts";
import type { MoneyExpense } from "./money-out.ts";
import { REPORTS } from "./registry.ts";
import { MEASURES } from "./measures.ts";

describe("standard filters", () => {
  test("every report reads the same words from its address", () => {
    assert.deepEqual(standardFilters({ vendor: "v1", category: ["c1", "c2"], item: [], status: "paid", junk: "x" }), {
      vendors: ["v1"],
      categories: ["c1", "c2"],
      items: [],
      status: "paid",
    });
  });

  test("nothing chosen is everything, counting everything live; old status names still read", () => {
    assert.deepEqual(standardFilters({}), { vendors: [], categories: [], items: [], status: "spend" });
    assert.equal(standardFilters({ status: "approved" }).status, "accrued");
    assert.equal(standardFilters({ status: "nonsense" }).status, "spend");
  });

  test("a vendor is keyed by its record, or by its name when it has none", () => {
    assert.equal(vendorKey("abc", "Costco"), "abc");
    assert.equal(vendorKey(null, "Corner Shop"), "raw:Corner Shop");
  });

  test("menus list each thing once, by name; a choice not on offer is dropped", () => {
    const options = optionsOf([
      { key: "b", label: "Bakery" },
      { key: "a", label: "Meat" },
      { key: "b", label: "Bakery" },
    ]);
    assert.deepEqual(options, [
      { value: "b", label: "Bakery" },
      { value: "a", label: "Meat" },
    ]);
    assert.deepEqual(offered(["a", "gone"], options), ["a"]);
  });

  test("a download says what it is narrowed to, and nothing when it isn't", () => {
    const options = { vendors: [{ value: "v1", label: "Costco" }], categories: [{ value: "c1", label: "Meat" }] };
    assert.equal(describeSelection({ vendors: ["v1"], categories: ["c1"] }, options), "Vendors: Costco · Categories: Meat");
    assert.equal(describeSelection({ vendors: [] }, options), "");
  });
});

let n = 0;
function paid(vendor: string, total: number): MoneyExpense {
  n += 1;
  return {
    id: `e${n}`,
    entry: `E-${n}`,
    status: "paid",
    vendor,
    vendorKey: vendorKey(null, vendor),
    payee: "Aliasgar",
    total,
    submittedOn: "2026-07-01",
    decidedOn: "2026-07-02",
    paidOn: "2026-07-10",
    runId: null,
    runNumber: null,
    reference: null,
    bankConfirmedOn: null,
  };
}

describe("Money out, narrowed to a vendor", () => {
  const rows = { paidInPeriod: [paid("Costco", 100), paid("Harris Farm", 40), paid("Costco", 60)] };
  const period = { code: "cy2026-m7", calendar: "cy" as const, year: 2026, part: { type: "month" as const, month: 7 }, start: "2026-07-01", end: "2026-07-31", label: "July 2026" };

  test("the menu offers every vendor in the section; the figures are the chosen vendor's", () => {
    const all = moneyOutViewFrom("paid", period, rows, [], "2026-08-01");
    assert.deepEqual(all.vendorOptions.map((o) => o.label), ["Costco", "Harris Farm"]);
    assert.ok(all.section === "paid");
    assert.equal(all.report.total, 200);

    const costco = moneyOutViewFrom("paid", period, rows, ["raw:Costco"], "2026-08-01");
    assert.ok(costco.section === "paid");
    assert.equal(costco.report.total, 160);
    assert.equal(costco.report.expenseCount, 2);
    // The menu still offers the others, so the filter can be changed.
    assert.equal(costco.vendorOptions.length, 2);
  });

  test("a vendor with nothing in the section is dropped, not left selecting nothing", () => {
    const view = moneyOutViewFrom("paid", period, rows, ["raw:Nobody"], "2026-08-01");
    assert.deepEqual(view.vendors, []);
    assert.ok(view.section === "paid");
    assert.equal(view.report.total, 200);
  });

  test("awaiting payment is narrowed the same way", () => {
    const approved = [{ ...paid("Costco", 30), status: "approved", paidOn: null }, { ...paid("Harris Farm", 70), status: "approved", paidOn: null }];
    const view = moneyOutViewFrom("waiting", null, { approved }, ["raw:Harris Farm"], "2026-08-01");
    assert.ok(view.section === "waiting");
    assert.equal(view.report.amount, 70);
  });
});

describe("Budgets, narrowed to categories", () => {
  const rows = [
    { id: "a", label: "Meat › Mutton" },
    { id: "b", label: "Dry goods" },
  ];
  test("shows the chosen categories; every category stays on the menu", () => {
    const view = narrowBudgetRows(rows, ["b"]);
    assert.deepEqual(view.rows.map((r) => r.id), ["b"]);
    assert.equal(view.categoryOptions.length, 2);
    assert.deepEqual(narrowBudgetRows(rows, []).rows.length, 2);
    assert.deepEqual(narrowBudgetRows(rows, ["deleted"]).rows.length, 2);
  });
});

describe("the report registry", () => {
  test("every report says what it is, which filters it takes and which measures it shows", () => {
    for (const r of REPORTS) {
      assert.ok(r.description.length > 20, `${r.key} has no description`);
      assert.ok(r.filters.length > 0, `${r.key} takes no filters`);
      assert.ok(r.measures.length > 0 && r.measures.every((m) => m in MEASURES), `${r.key} names no measures`);
      assert.ok(r.path.startsWith("/"));
    }
    assert.equal(new Set(REPORTS.map((r) => r.key)).size, REPORTS.length);
  });

  test("the row of links is the registry's, in its order", () => {
    assert.deepEqual(
      REPORTS.filter((r) => r.nav).map((r) => r.nav!.label),
      ["Spending", "Money out", "Exceptions", "Budgets", "GST"]
    );
  });
});
