import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { channelState } from "./notification-kinds.ts";
import { ruleMatches, type AlertRule } from "./alert-rules.ts";
import { grantsForDuty, dutyForGrant, isActive } from "./stand-ins.ts";
import { daysBetween, summarise, sydneyDay } from "./reminders.ts";

describe("channelState — #28", () => {
  test("with nothing chosen, the kind's own default applies", () => {
    assert.deepEqual(channelState("expense_to_review", "push", undefined, []), { enabled: true, lockedBy: null });
    assert.deepEqual(channelState("expense_submitted", "email", undefined, []), { enabled: false, lockedBy: null });
  });

  test("a team's starting choice beats the default, and a person's own beats the team's", () => {
    assert.equal(channelState("expense_submitted", "email", undefined, [{ enabled: true, required: false }]).enabled, true);
    assert.equal(channelState("expense_submitted", "email", false, [{ enabled: true, required: false }]).enabled, false);
  });

  test("any one team making it required locks it on", () => {
    const state = channelState("expense_paid", "email", false, [
      { enabled: false, required: false },
      { enabled: true, required: true },
    ]);
    assert.deepEqual(state, { enabled: true, lockedBy: "team" });
  });

  test("an escalation always arrives by push and email", () => {
    assert.deepEqual(channelState("escalation", "email", false, []), { enabled: true, lockedBy: "app" });
    assert.equal(channelState("escalation", "in_app", false, []).lockedBy, null);
  });
});

describe("ruleMatches — alert rules", () => {
  const rule = (over: Partial<AlertRule>): AlertRule => ({
    id: "r",
    name: "Big event spend",
    event: "expense_submitted",
    conditions: {},
    recipients: {},
    active: true,
    ...over,
  });

  test("an Events expense over $1,000 is submitted", () => {
    const r = rule({ conditions: { minAmount: 1000, categoryIds: ["events"] } });
    assert.equal(ruleMatches(r, "expense_submitted", { amount: 1500, categoryIds: ["meat", "events"] }), true);
    assert.equal(ruleMatches(r, "expense_submitted", { amount: 900, categoryIds: ["events"] }), false);
    assert.equal(ruleMatches(r, "expense_submitted", { amount: 1500, categoryIds: ["meat"] }), false);
    assert.equal(ruleMatches(r, "expense_approved", { amount: 1500, categoryIds: ["events"] }), false);
  });

  test("a vendor condition, and an inactive rule", () => {
    assert.equal(ruleMatches(rule({ conditions: { vendorIds: ["v1"] } }), "expense_submitted", { vendorId: "v2" }), false);
    assert.equal(ruleMatches(rule({ active: false }), "expense_submitted", {}), false);
  });

  test("a budget alert fires on crossing the line, not on every expense past it", () => {
    const r = rule({ event: "budget_threshold", conditions: { budgetPercent: 80 } });
    const cross = { categoryId: "meat", usedBefore: 0.78, usedAfter: 0.83 };
    assert.equal(ruleMatches(r, "budget_threshold", { budget: cross }), true);
    assert.equal(ruleMatches(r, "budget_threshold", { budget: { ...cross, usedBefore: 0.81 } }), false);
  });
});

describe("reminders — #27", () => {
  test("whole Sydney days, across midnight UTC", () => {
    // 23:30 UTC on the 10th is already the 11th in Sydney.
    assert.equal(sydneyDay("2026-09-10T23:30:00Z"), "2026-09-11");
    assert.equal(daysBetween("2026-09-06", "2026-09-11"), 5);
  });

  test("a reminder once something reaches its first limit, and escalation past the second", () => {
    const items = [{ waitingDays: 1 }, { waitingDays: 3 }, { waitingDays: 6 }];
    assert.deepEqual(summarise(items, 2, 5), {
      remind: { count: 2, oldest: 6 },
      escalate: { count: 1, oldest: 6 },
    });
    assert.deepEqual(summarise([{ waitingDays: 1 }], 2, 5), { remind: null, escalate: null });
  });
});

describe("stand-ins — #35", () => {
  test("a duty carries its own action and seeing the page, nothing else", () => {
    assert.deepEqual(grantsForDuty("approve"), ["approvals:approve", "approvals:view"]);
    assert.equal(dutyForGrant("payments", "mark_paid"), "pay");
    assert.equal(dutyForGrant("admin_users", "manage_users"), null);
  });

  test("in force between its dates, inclusive, unless cancelled", () => {
    const row = { starts_on: "2026-09-10", ends_on: "2026-09-20", cancelled_at: null };
    assert.equal(isActive(row, "2026-09-10"), true);
    assert.equal(isActive(row, "2026-09-21"), false);
    assert.equal(isActive({ ...row, cancelled_at: "2026-09-11T00:00:00Z" }, "2026-09-12"), false);
  });
});
