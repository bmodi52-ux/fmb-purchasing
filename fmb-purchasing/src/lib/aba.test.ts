import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAbaFile, checkPayment, checkSettings, type AbaSettings } from "./aba.ts";

const settings: AbaSettings = {
  bankAbbreviation: "nab",
  userName: "Faiz ul Mawaid il Burhaniyah Sydney",
  userId: "123456",
  bsb: "082-112",
  accountNumber: "12345678",
  remitterName: "FMB SYDNEY",
  description: "Payments",
  balancing: false,
};

const payment = {
  bsb: "062000",
  accountNumber: "98765432",
  accountName: "Taj Mart Pty Ltd",
  amountCents: 506576,
  reference: "FMB E-0012",
};

describe("buildAbaFile", () => {
  const file = buildAbaFile(settings, [payment, { ...payment, accountName: "Ali Abbas", amountCents: 181921 }], "2026-09-11");
  const lines = file.split("\r\n").filter(Boolean);

  test("every record is exactly 120 characters, ending in CRLF", () => {
    assert.equal(lines.length, 4);
    for (const line of lines) assert.equal(line.length, 120, line);
    assert.ok(file.endsWith("\r\n"));
  });

  test("the descriptive record names the bank, FMB, its user ID and the day", () => {
    const h = lines[0];
    assert.equal(h[0], "0");
    assert.equal(h.slice(18, 20), "01");
    assert.equal(h.slice(20, 23), "NAB");
    assert.equal(h.slice(30, 56), "FAIZ UL MAWAID IL BURHANIY");
    assert.equal(h.slice(56, 62), "123456");
    assert.equal(h.slice(62, 74), "PAYMENTS    ");
    assert.equal(h.slice(74, 80), "110926");
  });

  test("a detail record carries the BSB, account, amount in cents, name and reference", () => {
    const d = lines[1];
    assert.equal(d[0], "1");
    assert.equal(d.slice(1, 8), "062-000");
    assert.equal(d.slice(8, 17), " 98765432");
    assert.equal(d.slice(18, 20), "50");
    assert.equal(d.slice(20, 30), "0000506576");
    assert.equal(d.slice(30, 62).trimEnd(), "TAJ MART PTY LTD");
    assert.equal(d.slice(62, 80).trimEnd(), "FMB E-0012");
    assert.equal(d.slice(80, 87), "082-112");
    assert.equal(d.slice(87, 96), " 12345678");
    assert.equal(d.slice(96, 112).trimEnd(), "FMB SYDNEY");
    assert.equal(d.slice(112, 120), "00000000");
  });

  test("the file total adds up the credits and counts the detail records", () => {
    const t = lines[3];
    assert.equal(t[0], "7");
    assert.equal(t.slice(1, 8), "999-999");
    assert.equal(t.slice(20, 30), "0000688497");
    assert.equal(t.slice(30, 40), "0000688497");
    assert.equal(t.slice(40, 50), "0000000000");
    assert.equal(t.slice(74, 80), "000002");
  });

  test("a balancing record takes the total from FMB's own account and nets the file to zero", () => {
    const balanced = buildAbaFile({ ...settings, balancing: true }, [payment], "2026-09-11").split("\r\n").filter(Boolean);
    assert.equal(balanced.length, 4);
    assert.equal(balanced[2].slice(18, 20), "13");
    assert.equal(balanced[2].slice(1, 8), "082-112");
    assert.equal(balanced[3].slice(20, 30), "0000000000");
    assert.equal(balanced[3].slice(74, 80), "000002");
  });
});

describe("checks before building", () => {
  test("a payment the bank would reject says why", () => {
    assert.match(checkPayment({ ...payment, bsb: "06200" })!, /BSB/);
    assert.match(checkPayment({ ...payment, accountNumber: "1234567890" })!, /nine digits/);
    assert.match(checkPayment({ ...payment, amountCents: 0 })!, /more than zero/);
    assert.equal(checkPayment(payment), null);
  });

  test("settings without the bank's user ID are refused", () => {
    assert.match(checkSettings({ ...settings, userId: "12" })!, /six digits/);
    assert.throws(() => buildAbaFile({ ...settings, bankAbbreviation: "" }, [payment], "2026-09-11"));
  });
});
