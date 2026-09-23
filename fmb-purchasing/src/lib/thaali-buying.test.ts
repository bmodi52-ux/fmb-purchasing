import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isDue, newlyAssigned, orderByDate, urgency } from "./thaali-buying.ts";

describe("order-by dates", () => {
  test("the day before, unless the vendor needs more notice", () => {
    assert.equal(orderByDate("2026-10-02", null), "2026-10-01");
    assert.equal(orderByDate("2026-10-02", 3), "2026-09-29");
    assert.equal(orderByDate("2026-10-02", 0), "2026-10-02");
  });

  test("due once the order-by date arrives, and until the day itself", () => {
    const line = { status: "to_order" as const, serviceDate: "2026-10-02", leadDays: 2 };
    assert.equal(isDue(line, "2026-09-29"), false);
    assert.equal(isDue(line, "2026-09-30"), true);
    assert.equal(isDue(line, "2026-10-02"), true);
    assert.equal(isDue(line, "2026-10-03"), false, "a day that has passed is past nudging");
  });

  test("anything already ordered is never due", () => {
    assert.equal(isDue({ status: "ordered", serviceDate: "2026-10-02", leadDays: null }, "2026-10-01"), false);
  });

  test("the list says how pressing it is", () => {
    const line = (serviceDate: string) => ({ status: "to_order" as const, serviceDate, leadDays: 1 });
    assert.equal(urgency(line("2026-10-02"), "2026-10-02"), "late");
    assert.equal(urgency(line("2026-10-02"), "2026-10-01"), "today");
    assert.equal(urgency(line("2026-10-02"), "2026-09-29"), "soon");
    assert.equal(urgency(line("2026-10-09"), "2026-09-29"), null);
  });
});

describe("who a release tells", () => {
  test("everyone given a line that was new or somebody else's", () => {
    const before = [
      { itemId: "goat", ownerId: "ali", section: "meat" as const },
      { itemId: "onion", ownerId: "ali", section: "produce" as const },
    ];
    const after = [
      { itemId: "goat", ownerId: "ali", section: "meat" as const },
      { itemId: "onion", ownerId: "sara", section: "produce" as const },
      { itemId: "rice", ownerId: "sara", section: "dry" as const },
      { itemId: "salt", ownerId: null, section: "dry" as const },
    ];
    const told = newlyAssigned(before, after);
    assert.equal(told.has("ali"), false, "nothing of Ali's changed");
    assert.deepEqual(told.get("sara"), { count: 2, sections: ["produce", "dry"] });
  });

  test("releasing again with nothing moved tells nobody", () => {
    const lines = [{ itemId: "goat", ownerId: "ali", section: "meat" as const }];
    assert.equal(newlyAssigned(lines, lines).size, 0);
  });
});
