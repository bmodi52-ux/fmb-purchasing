import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTestDb, type TestDb } from "./test-db.ts";
import { LINE_OFFER } from "./supabase/relationships.ts";

/**
 * Receipt lines and offers are linked twice since 0078, so an embed between
 * them has to name its link or the database API refuses it (#56). The Reports
 * page failed that way, and the Expenses page lost its line details, and no
 * test saw it: the query is only wrong against the real API.
 */

let db: TestDb;

before(async () => {
  db = await createTestDb();
});

after(async () => {
  await db?.close();
});

test("the link embeds name exists, and is the line's own offer", async () => {
  const r = await db.query<{ table: string; column: string; target: string }>(
    `select c.conrelid::regclass::text as table, a.attname as column, c.confrelid::regclass::text as target
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.conname = $1`,
    [LINE_OFFER]
  );
  assert.deepEqual(r.rows, [{ table: "expense_line_items", column: "pricelist_item_id", target: "pricelist_items" }]);
});

test("receipt lines and offers are linked more than once, which is why embeds must say which", async () => {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from pg_constraint
     where contype = 'f'
       and ((conrelid = 'expense_line_items'::regclass and confrelid = 'pricelist_items'::regclass)
         or (conrelid = 'pricelist_items'::regclass and confrelid = 'expense_line_items'::regclass))`
  );
  assert.ok(r.rows[0]!.n > 1);
});

test("no query embeds offers or receipt lines without naming the link", () => {
  const src = path.join(import.meta.dirname, "..");
  const unnamed: string[] = [];
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const lines = readFileSync(path.join(src, file), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // `pricelist_items (` or `expense_line_items(` inside a select; a
      // `pricelist_items!link (` embed, or `.from("pricelist_items")`, is fine.
      if (/\b(pricelist_items|expense_line_items)\s*\(/.test(line)) unnamed.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(unnamed, []);
});
