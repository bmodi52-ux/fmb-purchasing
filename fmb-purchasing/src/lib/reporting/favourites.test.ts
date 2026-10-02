import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "../test-db.ts";
import { favouritesFirst } from "./favourites.ts";

describe("favouritesFirst", () => {
  const reports = [{ key: "spend" }, { key: "money-out" }, { key: "exceptions" }, { key: "budgets" }];
  const keys = (favourites: string[]) => favouritesFirst(reports, favourites).map((r) => r.key);

  test("starred reports lead, in the order they were starred", () => {
    assert.deepEqual(keys(["budgets", "money-out"]), ["budgets", "money-out", "spend", "exceptions"]);
  });

  test("with none starred the list is as it came", () => {
    assert.deepEqual(keys([]), ["spend", "money-out", "exceptions", "budgets"]);
  });

  test("a star on a report that is no longer offered changes nothing", () => {
    assert.deepEqual(keys(["retired", "exceptions"]), ["exceptions", "spend", "money-out", "budgets"]);
  });
});

/** Migration 0088: one star per person and report, gone with the person. */
describe("report_favourites", () => {
  let db: TestDb;
  let user: string;

  before(async () => {
    db = await createTestDb();
    // A profile is made by the trigger on auth.users.
    user = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('member@test.local', '{"full_name": "Member"}'::jsonb) returning id`
    );
  });

  after(async () => {
    await db?.close();
  });

  const star = (key: string) => db.query("insert into report_favourites (user_id, report_key) values ($1, $2)", [user, key]);

  test("a report is starred once per person", async () => {
    await star("money-out");
    await assert.rejects(star("money-out"));
    await star("budgets");
    assert.equal(await scalar<number>(db, "select count(*)::int from report_favourites where user_id = $1", [user]), 2);
  });

  test("only something shaped like a report key is kept", async () => {
    await assert.rejects(star(""));
    await assert.rejects(star("Money Out"));
    await assert.rejects(star("x".repeat(65)));
  });

  test("row level security is on, as for every table", async () => {
    assert.equal(await scalar<boolean>(db, "select relrowsecurity from pg_class where relname = 'report_favourites'"), true);
  });

  test("a person's stars go when they do", async () => {
    await db.query("delete from auth.users where id = $1", [user]);
    assert.equal(await scalar<number>(db, "select count(*)::int from report_favourites"), 0);
  });
});
