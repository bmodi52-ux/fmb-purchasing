import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildHref, queryFromSaved, queryFromSearchParams, type ReportQuery } from "./query.ts";
import { describeBasis, parseStatusBasis, withStatusBasis } from "./basis.ts";
import { flattenLineEmbed, monthsCovering, withinRange, type EmbeddedLineRow, type Ledger } from "./ledger-rows.ts";

describe("report queries", () => {
  test("a URL round-trips: what buildHref writes, the page reads back", () => {
    const q: ReportQuery = {
      period: "au2026",
      section: "compare",
      status: "approved",
      vendors: ["v1"],
      categories: ["c1", "c2"],
      items: [],
      breakdownBy: "vendor",
      compareBy: "category",
    };
    const params = new URLSearchParams(buildHref(q, {}).split("?")[1]);
    const back = queryFromSearchParams(
      {
        section: params.get("section") ?? undefined,
        status: params.get("status") ?? undefined,
        vendor: params.getAll("vendor"),
        category: params.getAll("category"),
        item: params.getAll("item"),
        breakdownBy: params.get("breakdownBy") ?? undefined,
        compareBy: params.get("compareBy") ?? undefined,
      },
      params.get("period")!
    );
    assert.deepEqual(back, q);
  });

  test("defaults are left out of the URL", () => {
    const plain = queryFromSearchParams({}, "h1448");
    assert.equal(buildHref(plain, {}), "/reports?period=h1448");
  });

  test("a single filter value arrives as a string and is read as a list", () => {
    assert.deepEqual(queryFromSearchParams({ vendor: "v1" }, "au2026").vendors, ["v1"]);
  });

  test("nonsense is replaced by the default, not passed on", () => {
    const q = queryFromSearchParams({ section: "drop table", status: "everything", breakdownBy: "colour" }, "au2026");
    assert.equal(q.section, "overview");
    assert.equal(q.status, "committed");
    assert.equal(q.breakdownBy, "category");
  });

  test("a view saved before the status filter existed opens counting everything live", () => {
    const old = { period: "h1447", section: "breakdown", vendors: [], categories: ["c1"], items: [], breakdownBy: "category", compareBy: "item" };
    assert.equal(queryFromSaved(old)?.status, "committed");
    assert.equal(queryFromSaved(JSON.stringify(old))?.categories[0], "c1");
  });

  test("a saved query with no period, or not JSON, is refused", () => {
    assert.equal(queryFromSaved({ section: "overview" }), null);
    assert.equal(queryFromSaved("{not json"), null);
  });
});

describe("bases", () => {
  test("say which expenses count and by which date", () => {
    assert.equal(describeBasis("approved"), "By receipt date · approved and paid");
    assert.equal(describeBasis("paid", "paid"), "By payment date · paid");
    assert.equal(parseStatusBasis("paid"), "paid");
    assert.equal(parseStatusBasis(undefined), "committed");
  });

  test("a basis keeps an expense's lines and unit costs with it", () => {
    const ledger = {
      expenses: [
        { id: "a", status: "submitted" },
        { id: "b", status: "paid" },
      ],
      lines: [{ expenseId: "a" }, { expenseId: "b" }],
      unitCosts: [{ expense_id: "a" }, { expense_id: "b" }],
    };
    const paid = withStatusBasis(ledger, "paid");
    assert.deepEqual(paid.expenses.map((e) => e.id), ["b"]);
    assert.deepEqual(paid.lines, [{ expenseId: "b" }]);
    assert.deepEqual(paid.unitCosts, [{ expense_id: "b" }]);
  });
});

describe("ledger rows", () => {
  test("a line's item is lifted out of its embed", () => {
    const row = {
      id: "l1",
      expense_id: "e1",
      kind: "goods",
      category_id: null,
      description_raw: "CHKN THGH",
      line_total: 24,
      line_gst: 0,
      gst_applicable: false,
      quantity: 2,
      is_capital: false,
      not_on_receipt: false,
      pricelist_items: { item_pack_sizes: { items: { id: "i1", name: "Chicken thigh" } } },
    } satisfies EmbeddedLineRow;
    const flat = flattenLineEmbed(row);
    assert.equal(flat.item_id, "i1");
    assert.equal(flat.item_name, "Chicken thigh");
    assert.equal("pricelist_items" in flat, false);
    assert.equal(flattenLineEmbed({ ...row, pricelist_items: null }).item_id, null);
  });

  test("months covering a range, across a year end and a leap February", () => {
    assert.deepEqual(
      monthsCovering({ start: "2027-12-15", end: "2028-02-03" }).map((m) => [m.start, m.end]),
      [
        ["2027-12-01", "2027-12-31"],
        ["2028-01-01", "2028-01-31"],
        ["2028-02-01", "2028-02-29"],
      ]
    );
    assert.equal(monthsCovering({ start: "2026-07-01", end: "2027-06-30" }).length, 12);
    assert.equal(monthsCovering({ start: "2026-07-09", end: "2026-07-09" }).length, 1);
  });

  test("a range is trimmed by the day each expense counts on, inclusively", () => {
    const e = (id: string, reportDate: string) => ({ id, reportDate }) as Ledger["expenses"][number];
    const ledger: Ledger = {
      expenses: [e("jun", "2026-06-30"), e("jul1", "2026-07-01"), e("jul31", "2026-07-31"), e("aug", "2026-08-01")],
      lines: [],
      unitCosts: [],
    };
    assert.deepEqual(
      withinRange(ledger, { start: "2026-07-01", end: "2026-07-31" }).expenses.map((x) => x.id),
      ["jul1", "jul31"]
    );
  });
});
