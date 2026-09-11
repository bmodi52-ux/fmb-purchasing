import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchStatement, parseStatementCsv, parseStatementDate } from "./bank-statement.ts";

describe("parseStatementCsv", () => {
  test("a header-less export in date, amount, description order (CommBank, ANZ)", () => {
    const { lines } = parseStatementCsv(
      `11/09/2026,"-5,065.76","TRANSFER TO TAJ MART FMB E-0012",+12000.00\n12/09/2026,+250.00,"DEPOSIT",+12250.00`
    );
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].date, lines[0].amountCents], ["2026-09-11", 506576]);
  });

  test("separate debit and credit columns with a header (Westpac)", () => {
    const { lines } = parseStatementCsv(
      "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance\n032000123456,11/09/2026,PAYMENT ALI ABBAS,1819.21,,500.00\n032000123456,11/09/2026,INTEREST,,1.20,501.20"
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].description, "PAYMENT ALI ABBAS");
    assert.equal(lines[0].amountCents, 181921);
  });

  test("dates in the shapes banks use", () => {
    assert.equal(parseStatementDate("11/9/26"), "2026-09-11");
    assert.equal(parseStatementDate("11 Sep 2026"), "2026-09-11");
    assert.equal(parseStatementDate("2026-09-11"), "2026-09-11");
    assert.equal(parseStatementDate("31/02/2026"), null);
  });
});

describe("matchStatement", () => {
  const line = (date: string, amountCents: number, description: string) => ({ date, amountCents, description, raw: "" });

  test("the same amount a day or two later matches; a reference beats closeness", () => {
    const lines = [line("2026-09-12", 10000, "TRANSFER"), line("2026-09-15", 10000, "PAYMENT PR-0007")];
    const { matches, unmatchedLines } = matchStatement(
      [
        { key: "a", date: "2026-09-11", amountCents: 10000, reference: "PR-0007", payeeName: "A" },
        { key: "b", date: "2026-09-11", amountCents: 10000, reference: null, payeeName: "B" },
      ],
      lines
    );
    assert.equal(matches.find((m) => m.payment.key === "a")?.line.description, "PAYMENT PR-0007");
    assert.equal(matches.find((m) => m.payment.key === "b")?.line.description, "TRANSFER");
    assert.equal(unmatchedLines.length, 0);
  });

  test("a payment recorded but not on the statement is left unmatched", () => {
    const { unmatchedPayments } = matchStatement(
      [{ key: "a", date: "2026-09-01", amountCents: 5000, reference: null, payeeName: "A" }],
      [line("2026-09-30", 5000, "TOO LATE")]
    );
    assert.equal(unmatchedPayments.length, 1);
  });
});
