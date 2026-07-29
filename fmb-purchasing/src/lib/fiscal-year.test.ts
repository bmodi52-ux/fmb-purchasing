import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fiscalYearHijri, formatFiscalYear } from "./fiscal-year.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("formatFiscalYear", () => {
  test("renders the two-year span", () => {
    assert.equal(formatFiscalYear(1447), "1447-48 H");
    assert.equal(formatFiscalYear(1448), "1448-49 H");
  });

  test("pads across a century boundary rather than printing '1499-0 H'", () => {
    assert.equal(formatFiscalYear(1499), "1499-00 H");
    assert.equal(formatFiscalYear(1509), "1509-10 H");
  });
});

describe("fiscalYearHijri", () => {
  /**
   * Characterisation tests, pinned to what the live database already holds:
   * these receipt dates were filed under FY1447 by this same function, so a
   * change in the Hijri conversion or the Shawwal boundary would show up
   * here rather than silently refiling historical expenses.
   */
  test("agrees with the fiscal years already recorded against real receipts", () => {
    assert.equal(fiscalYearHijri(new Date("2026-05-05T00:00:00Z")), 1447);
    assert.equal(fiscalYearHijri(new Date("2026-07-28T00:00:00Z")), 1447);
  });

  /**
   * The properties below hold whatever the calendar's exact epoch is, so
   * they test the boundary logic without hard-coding a conversion table
   * whose correctness would itself need checking.
   */
  test("is gap-free: consecutive days never skip a fiscal year", () => {
    let previous = fiscalYearHijri(new Date("2024-01-01T00:00:00Z"));
    for (let i = 1; i < 365 * 4; i++) {
      const current = fiscalYearHijri(new Date(Date.UTC(2024, 0, 1) + i * DAY_MS));
      const step = current - previous;
      assert.ok(
        step === 0 || step === 1,
        `fiscal year jumped by ${step} on day ${i} (${previous} -> ${current})`
      );
      previous = current;
    }
  });

  test("never runs backwards as dates move forwards", () => {
    let previous = fiscalYearHijri(new Date("2020-01-01T00:00:00Z"));
    for (let i = 1; i < 365 * 8; i++) {
      const current = fiscalYearHijri(new Date(Date.UTC(2020, 0, 1) + i * DAY_MS));
      assert.ok(current >= previous, `went backwards on day ${i}`);
      previous = current;
    }
  });

  test("each fiscal year spans a lunar year — about 354 days, never a solar 365", () => {
    // A fiscal year that came out at 365+ days would mean the boundary was
    // being taken from the Gregorian calendar somewhere.
    const lengths = new Map<number, number>();
    for (let i = 0; i < 365 * 6; i++) {
      const fy = fiscalYearHijri(new Date(Date.UTC(2024, 0, 1) + i * DAY_MS));
      lengths.set(fy, (lengths.get(fy) ?? 0) + 1);
    }

    // Drop the first and last, which the window only partly covers.
    const complete = [...lengths.entries()].sort((a, b) => a[0] - b[0]).slice(1, -1);
    assert.ok(complete.length > 0, "expected at least one complete fiscal year in the window");

    for (const [fy, days] of complete) {
      assert.ok(
        days === 354 || days === 355,
        `FY${fy} spanned ${days} days; a lunar year is 354 or 355`
      );
    }
  });
});
