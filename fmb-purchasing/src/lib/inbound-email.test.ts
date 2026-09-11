import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { failsAuthentication, messageFileName, senderOf } from "./inbound-email.ts";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

describe("receipts by email", () => {
  test("refused only when the receiving service says the sender was forged", () => {
    assert.equal(failsAuthentication([]), false);
    assert.equal(failsAuthentication(["mx.example; spf=pass; dkim=pass; dmarc=pass"]), false);
    assert.equal(failsAuthentication(["mx.example; spf=pass; dkim=none; dmarc=fail (p=quarantine)"]), true);
    // A forwarded message often fails SPF while its signature still holds.
    assert.equal(failsAuthentication(["mx.example; spf=fail; dkim=pass header.d=example.org"]), false);
    assert.equal(failsAuthentication(["mx.example; SPF=FAIL; dkim=none"]), true);
  });

  test("the sender's address, lowercased", () => {
    assert.equal(senderOf({ address: " Treasurer@Example.ORG " }), "treasurer@example.org");
    assert.equal(senderOf({ address: "" }), null);
    assert.equal(senderOf(null), null);
  });

  test("the stored file is named after the subject, without the forwarding prefixes", () => {
    assert.equal(messageFileName("Fwd: RE: Invoice 4411 / Taj Mart"), "Invoice 4411 Taj Mart.eml");
    assert.equal(messageFileName(""), "Emailed receipt.eml");
  });
});

describe("0054", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(async () => {
    await db?.close();
  });

  test("the same message from the same person is one emailed receipt", async () => {
    const user = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('member@test.local', '{"full_name": "Member"}'::jsonb) returning id`
    );
    const sha = "a".repeat(64);
    const insert = () =>
      db.query(
        `insert into inbound_receipts (user_id, from_email, storage_path, sha256, file_name, size_bytes)
         values ($1, 'member@test.local', 'sha256/aa/x.eml', $2, 'x.eml', 10)`,
        [user, sha]
      );
    await insert();
    await assert.rejects(insert());
    await assert.rejects(
      db.query(`update inbound_receipts set status = 'lost' where user_id = $1`, [user])
    );
  });

  test("vendor defaults accept only the known choices, and a run can't be opened twice", async () => {
    const vendor = await scalar<string>(db, "insert into vendors (name) values ('Fresh Poultry') returning id");
    await db.query("update vendors set default_payee = 'vendor', gst_treatment = 'gst_free' where id = $1", [vendor]);
    await assert.rejects(db.query("update vendors set gst_treatment = 'sometimes' where id = $1", [vendor]));

    await db.query("insert into extraction_benchmark_runs (model, case_count) values ('m', 1)");
    await assert.rejects(db.query("insert into extraction_benchmark_runs (model, case_count) values ('m', 1)"));
  });

  test("a receipt emailed in notifies as its own kind", async () => {
    const user = await scalar<string>(db, "select id from profiles limit 1");
    await db.query("insert into notifications (user_id, kind, title) values ($1, 'receipt_received', 'Ready')", [user]);
  });
});

describe("0056", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(async () => {
    await db?.close();
  });

  test("a photo from the phone needs no sender; an emailed receipt still does", async () => {
    const user = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('phone@test.local', '{"full_name": "Phone"}'::jsonb) returning id`
    );
    await db.query(
      `insert into inbound_receipts (user_id, source, content_type, storage_path, sha256, file_name, size_bytes)
       values ($1, 'phone', 'image/jpeg', 'sha256/bb/x.jpg', $2, 'x.jpg', 10)`,
      [user, "b".repeat(64)]
    );
    await assert.rejects(
      db.query(
        `insert into inbound_receipts (user_id, source, storage_path, sha256, file_name, size_bytes)
         values ($1, 'email', 'sha256/cc/x.eml', $2, 'x.eml', 10)`,
        [user, "c".repeat(64)]
      )
    );
  });
});

describe("offline photos", () => {
  test("kept only when the failure was the connection", async () => {
    const { isConnectionFailure } = await import("./offline-queue.ts");
    assert.equal(isConnectionFailure(new Error("anything"), false), true);
    assert.equal(isConnectionFailure(new TypeError("Failed to fetch"), true), true);
    assert.equal(isConnectionFailure(new Error("Only JPG, PNG, WebP, PDF"), true), false);
  });
});
