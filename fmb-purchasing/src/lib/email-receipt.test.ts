import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseEmailReceipt, isEmail } from "./email-receipt";
import { receiptContentType, ACCEPTED_TYPES } from "./receipt-storage";

/**
 * Taking a saved email apart.
 *
 * This is the upload people were already making, by hand: the prompt has
 * always described "a forwarded email, printed to PDF". What matters here is
 * that the message body survives — it is routinely the only record of who to
 * pay, and sometimes of the amount — and that an attached invoice arrives as
 * bytes the model can actually look at rather than as base64 text.
 */

const CRLF = "\r\n";

/** A 1x1 PNG, so an attachment can be checked byte for byte after decoding. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function email(parts: string[]): Uint8Array {
  return new TextEncoder().encode(parts.join(CRLF));
}

const PLAIN = email([
  "From: Coordinator <coordinator@example.org>",
  "To: treasurer@example.org",
  "Subject: Please pay Taj Mart directly",
  "Date: Tue, 1 Sep 2026 16:10:00 +1000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please pay Taj Mart directly $5065.76 as per attached invoices.",
  "",
]);

const WITH_ATTACHMENT = email([
  "From: Coordinator <coordinator@example.org>",
  "Subject: Invoice attached",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Reimburse Huzaifa Bhai for the below.",
  "",
  "--b1",
  'Content-Type: image/png; name="invoice.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="invoice.png"',
  "",
  PNG_BASE64,
  "",
  "--b1--",
  "",
]);

const HTML_ONLY = email([
  "From: Shop <shop@example.com>",
  "Subject: Your tax invoice",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<html><head><style>p{color:red}</style></head><body>",
  "<p>Total: <b>$1,944.00</b></p><p>Thank you</p>",
  "</body></html>",
  "",
]);

const UNSUPPORTED_ATTACHMENT = email([
  "From: Supplier <supplier@example.com>",
  "Subject: Statement",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Statement attached.",
  "",
  "--b2",
  'Content-Type: application/vnd.ms-excel; name="statement.xls"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="statement.xls"',
  "",
  "AAAA",
  "",
  "--b2--",
  "",
]);

describe("parseEmailReceipt", () => {
  test("keeps the instruction in the message body", async () => {
    const parsed = await parseEmailReceipt(PLAIN);
    assert.match(
      parsed.text,
      /pay Taj Mart directly \$5065\.76/,
      "the covering message is frequently the only record of who is owed"
    );
  });

  test("carries the headers a reviewer would want", async () => {
    const parsed = await parseEmailReceipt(PLAIN);
    assert.match(parsed.text, /Subject: Please pay Taj Mart directly/);
    assert.match(parsed.text, /coordinator@example\.org/);
  });

  test("an email with no attachments yields no documents", async () => {
    const parsed = await parseEmailReceipt(PLAIN);
    assert.equal(parsed.documents.length, 0);
    assert.equal(parsed.skipped.length, 0);
  });

  test("decodes an attached image back to its original bytes", async () => {
    const parsed = await parseEmailReceipt(WITH_ATTACHMENT);
    assert.equal(parsed.documents.length, 1);
    const [doc] = parsed.documents;
    assert.equal(doc!.mediaType, "image/png");
    assert.equal(doc!.fileName, "invoice.png");
    assert.deepEqual(
      Buffer.from(doc!.base64, "base64"),
      Buffer.from(PNG_BASE64, "base64"),
      "a transfer-encoding mistake here would hand the model a corrupt image"
    );
  });

  test("keeps the body alongside an attachment, not instead of it", async () => {
    const parsed = await parseEmailReceipt(WITH_ATTACHMENT);
    assert.match(parsed.text, /Reimburse Huzaifa Bhai/);
    assert.match(parsed.text, /Attached: invoice\.png/);
  });

  test("falls back to the HTML body when there is no plain text part", async () => {
    const parsed = await parseEmailReceipt(HTML_ONLY);
    assert.match(parsed.text, /\$1,944\.00/);
    assert.doesNotMatch(parsed.text, /color:red/, "style contents are not message text");
    assert.doesNotMatch(parsed.text, /<p>/, "tags are stripped, not shown to the model");
  });

  test("names an attachment it cannot show rather than dropping it silently", async () => {
    const parsed = await parseEmailReceipt(UNSUPPORTED_ATTACHMENT);
    assert.equal(parsed.documents.length, 0);
    assert.equal(parsed.skipped.length, 1);
    assert.equal(parsed.skipped[0]!.fileName, "statement.xls");
    assert.match(
      parsed.text,
      /not readable here: statement\.xls/,
      "otherwise a reviewer cannot tell why an invoice the email mentions never appeared"
    );
  });

  test("does not throw on an empty message", async () => {
    const parsed = await parseEmailReceipt(new TextEncoder().encode(""));
    assert.equal(typeof parsed.text, "string");
    assert.equal(parsed.documents.length, 0);
  });
});

describe("receiptContentType", () => {
  test("trusts a type the browser reported correctly", () => {
    assert.equal(receiptContentType("scan.pdf", "application/pdf"), "application/pdf");
  });

  test("recovers .eml when the browser reports nothing", () => {
    assert.equal(
      receiptContentType("forwarded.eml", ""),
      "message/rfc822",
      "Windows reports no type when nothing is registered to open .eml"
    );
  });

  test("recovers .eml from the octet-stream some mail clients send", () => {
    assert.equal(receiptContentType("Fwd invoice.EML", "application/octet-stream"), "message/rfc822");
  });

  test("leaves a genuinely unsupported file to be rejected", () => {
    assert.equal(receiptContentType("statement.xls", "application/vnd.ms-excel"), "application/vnd.ms-excel");
  });

  test("email uploads are actually on the allow-list", () => {
    assert.ok(ACCEPTED_TYPES.has("message/rfc822"));
    assert.ok(isEmail("message/rfc822"));
    assert.ok(!isEmail("application/pdf"));
  });
});
