import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTestDb, type TestDb } from "./test-db.ts";
import { LEDGERED_MIGRATIONS } from "./migrations.ts";

/**
 * The migration ledger — migration 0041.
 *
 * The ledger is only worth having if it is complete, and the only way it
 * stays complete is if forgetting to record a migration fails the build.
 */

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const ledgered = files.filter((f) => f >= "0041");

let db: TestDb;

before(async () => {
  db = await createTestDb();
});

after(async () => {
  await db?.close();
});

describe("schema_migrations", () => {
  test("every migration from 0041 records itself", () => {
    for (const file of ledgered) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const records = new RegExp(
        `insert into schema_migrations \\(filename\\) values[\\s\\S]*'${file.replace(".", "\\.")}'`
      );
      assert.match(sql, records, `${file} does not insert its own row into schema_migrations`);
    }
  });

  test("after every migration, the ledger names every file", async () => {
    const result = await db.query<{ filename: string }>(
      "select filename from schema_migrations order by filename"
    );
    assert.deepEqual(
      result.rows.map((r) => r.filename),
      files
    );
  });

  test("the list the app checks against matches the folder", () => {
    assert.deepEqual([...LEDGERED_MIGRATIONS], ledgered);
  });

  test("filenames the ledger would refuse are refused", async () => {
    await assert.rejects(
      db.query("insert into schema_migrations (filename) values ('not a migration')")
    );
  });
});
