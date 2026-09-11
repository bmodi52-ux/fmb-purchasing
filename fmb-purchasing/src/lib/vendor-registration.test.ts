import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readAbrRegistration } from "./abn-lookup.ts";
import { gstConcerns, registrationIsStale } from "./vendor-registration.ts";

describe("readAbrRegistration", () => {
  test("a GST date means registered from that date", () => {
    assert.deepEqual(readAbrRegistration({ Gst: "2000-07-01", AbnStatus: "Active" }), {
      gstRegistered: true,
      gstRegisteredFrom: "2000-07-01",
      abnActive: true,
    });
  });

  test("an empty or null GST field means not registered", () => {
    assert.equal(readAbrRegistration({ Gst: "" }).gstRegistered, false);
    assert.equal(readAbrRegistration({ Gst: null }).gstRegistered, false);
  });

  test("a missing GST field means unknown, never not registered", () => {
    assert.equal(readAbrRegistration({ EntityName: "X" }).gstRegistered, null);
  });

  test("a cancelled ABN", () => {
    assert.equal(readAbrRegistration({ AbnStatus: "Cancelled" }).abnActive, false);
    assert.equal(readAbrRegistration({}).abnActive, null);
  });
});

describe("gstConcerns", () => {
  test("GST charged by a vendor the ABR says is not registered", () => {
    assert.deepEqual(gstConcerns({ gst_registered: false, abn_active: true }, 12.5), ["gst-not-registered"]);
  });

  test("no GST charged, no concern", () => {
    assert.deepEqual(gstConcerns({ gst_registered: false, abn_active: true }, 0), []);
  });

  test("never checked is not a concern", () => {
    assert.deepEqual(gstConcerns({ gst_registered: null, abn_active: null }, 50), []);
  });

  test("a cancelled ABN is a concern whatever the GST", () => {
    assert.deepEqual(gstConcerns({ gst_registered: true, abn_active: false }, 0), ["abn-cancelled"]);
  });
});

describe("registrationIsStale", () => {
  const now = new Date("2026-09-11T00:00:00Z");
  test("never checked, or checked over 30 days ago", () => {
    assert.equal(registrationIsStale(null, now), true);
    assert.equal(registrationIsStale("2026-08-01T00:00:00Z", now), true);
    assert.equal(registrationIsStale("2026-09-01T00:00:00Z", now), false);
  });
});
