import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeColumnOrder, moveColumn } from "./column-order";

const ALL = ["entry", "date", "vendor", "type", "description", "category", "qty", "gst", "total"];

describe("mergeColumnOrder", () => {
  test("with nothing saved, the page's own order", () => {
    assert.deepEqual(mergeColumnOrder(ALL, []), ALL);
  });

  test("saved columns keep the order they were saved in", () => {
    const order = mergeColumnOrder(ALL, ["total", "vendor", "entry"]);
    assert.deepEqual(order.slice(0, 1), ["total"]);
    assert.ok(order.indexOf("vendor") < order.indexOf("entry"));
  });

  test("a hidden column goes back beside the one it follows on the page", () => {
    const order = mergeColumnOrder(ALL, ["entry", "vendor", "total"]);
    assert.equal(order.indexOf("date"), order.indexOf("entry") + 1);
    assert.equal(order.indexOf("type"), order.indexOf("vendor") + 1);
    assert.deepEqual(order, ALL, "saved in page order, nothing moves");
  });

  test("every column appears exactly once, and unknown saved keys are dropped", () => {
    const order = mergeColumnOrder(ALL, ["gone", "qty", "qty", "entry"]);
    assert.equal(order.length, ALL.length);
    assert.deepEqual([...order].sort(), [...ALL].sort());
  });
});

describe("moveColumn", () => {
  test("moves a column to the place given", () => {
    assert.deepEqual(moveColumn(["a", "b", "c", "d"], "d", 1), ["a", "d", "b", "c"]);
    assert.deepEqual(moveColumn(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  });

  test("clamps at both ends and ignores an unknown column", () => {
    assert.deepEqual(moveColumn(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveColumn(["a", "b", "c"], "b", 99), ["a", "c", "b"]);
    assert.deepEqual(moveColumn(["a", "b"], "z", 0), ["a", "b"]);
  });
});
