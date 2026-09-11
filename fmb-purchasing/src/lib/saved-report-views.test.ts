import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import { canSeeView, sortViews } from "./saved-report-views.ts";

describe("canSeeView", () => {
  const me = { id: "me", teamIds: ["kitchen"] };

  test("your own, whoever it is shared with", () => {
    assert.equal(canSeeView({ ownerId: "me", sharedWith: "private", teamIds: [] }, me), true);
  });

  test("someone else's only when shared with Reports, or with a team you are in", () => {
    assert.equal(canSeeView({ ownerId: "them", sharedWith: "private", teamIds: [] }, me), false);
    assert.equal(canSeeView({ ownerId: "them", sharedWith: "reports", teamIds: [] }, me), true);
    assert.equal(canSeeView({ ownerId: "them", sharedWith: "teams", teamIds: ["kitchen", "finance"] }, me), true);
    assert.equal(canSeeView({ ownerId: "them", sharedWith: "teams", teamIds: ["finance"] }, me), false);
  });

  test("own views first, then by name", () => {
    const sorted = sortViews(
      [
        { ownerId: "them", name: "Apples" },
        { ownerId: "me", name: "zucchini" },
        { ownerId: "me", name: "Meat" },
      ],
      "me"
    );
    assert.deepEqual(
      sorted.map((v) => v.name),
      ["Meat", "zucchini", "Apples"]
    );
  });
});

/** Migration 0053's constraints. */
describe("0053", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(async () => {
    await db?.close();
  });

  test("alert rules can be built on price changes and unusual spend", async () => {
    for (const event of ["price_change", "unusual_spend"]) {
      await db.query(`insert into alert_rules (name, event, recipients) values ('x', $1, '{}'::jsonb)`, [event]);
    }
    await assert.rejects(db.query(`insert into alert_rules (name, event, recipients) values ('x', 'nonsense', '{}'::jsonb)`));
  });

  test("an item's expected range cannot run backwards, nor a limit be zero", async () => {
    const unit = await scalar<string>(db, "select id from units where code = 'kg'");
    const item = await scalar<string>(db, "insert into items (name, canonical_unit_id) values ('Chicken', $1) returning id", [unit]);
    await db.query("update items set expected_min_per_unit = 6.5, expected_max_per_unit = 8 where id = $1", [item]);
    await assert.rejects(db.query("update items set expected_min_per_unit = 9 where id = $1", [item]));
    await assert.rejects(db.query("update items set price_rise_percent = 0 where id = $1", [item]));
  });

  test("a view shared with a team goes when the view does", async () => {
    const owner = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('owner@test.local', '{"full_name": "Owner"}'::jsonb) returning id`
    );
    const team = await scalar<string>(db, "insert into teams (name) values ('Kitchen') returning id");
    const view = await scalar<string>(
      db,
      `insert into saved_report_views (owner_id, name, query, shared_with)
       values ($1, 'Meat this year', '{"period":"h1448"}'::jsonb, 'teams') returning id`,
      [owner]
    );
    await db.query("insert into saved_report_view_teams (view_id, team_id) values ($1, $2)", [view, team]);
    await db.query("delete from saved_report_views where id = $1", [view]);
    assert.equal(Number(await scalar(db, "select count(*) from saved_report_view_teams where view_id = $1", [view])), 0);
    await assert.rejects(
      db.query(`insert into saved_report_views (owner_id, name, query, shared_with) values ($1, ' ', '{}'::jsonb, 'private')`, [owner])
    );
  });
});
