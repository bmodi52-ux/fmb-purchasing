import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0057: Accounting, Announcements, App settings and Backups &
 * records became pages of their own, and a whole row or column of the
 * permissions grid can be set in one call.
 */

let db: TestDb;
let actor: string;
let team: string;

before(async () => {
  db = await createTestDb();
  actor = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('perms@test.local', '{"full_name": "Perms"}'::jsonb) returning id`
  );
  team = await scalar<string>(db, "insert into teams (name) values ('Treasury') returning id");
});

after(async () => {
  await db?.close();
});

const granted = async (): Promise<string[]> =>
  (
    await db.query<{ pair: string }>(
      "select page_key || ':' || action_key as pair from team_permissions where team_id = $1 order by pair",
      [team]
    )
  ).rows.map((r) => r.pair);

describe("the split-out pages", () => {
  test("each is a page anyone can be granted, with a Manage action to go with it", async () => {
    const pages = (
      await db.query<{ key: string }>(
        "select key from app_pages where is_permission_scope order by sort_order"
      )
    ).rows.map((r) => r.key);
    for (const key of ["accounting", "announcements", "app_settings", "records"]) {
      assert.ok(pages.includes(key), key);
    }
    assert.equal(await scalar(db, "select label from app_actions where key = 'manage'"), "Manage");
  });

  test("the old grants no longer carry them", async () => {
    // A team that can pay, and administers accounts, holds only those.
    await db.query(
      `insert into team_permissions (team_id, page_key, action_key)
       values ($1, 'payments', 'mark_paid'), ($1, 'admin_users', 'manage_users')`,
      [team]
    );
    const pairs = await granted();
    assert.ok(!pairs.some((p) => p.startsWith("accounting:") || p.startsWith("app_settings:")));
  });
});

describe("admin_set_permissions", () => {
  test("grants a whole row, then clears it, recording every cell", async () => {
    await db.query("delete from team_permissions where team_id = $1", [team]);
    await db.query(
      "select admin_set_permissions($1, $2, array['accounting'], array['view','export','manage'], true)",
      [actor, team]
    );
    assert.deepEqual(await granted(), ["accounting:export", "accounting:manage", "accounting:view"]);

    const logged = Number(
      await scalar(db, "select count(*) from access_changes where kind = 'permission_granted' and actor_id = $1", [actor])
    );
    assert.equal(logged, 3, "each cell is its own entry in the access log");

    await db.query(
      "select admin_set_permissions($1, $2, array['accounting'], array['view','export','manage'], false)",
      [actor, team]
    );
    assert.deepEqual(await granted(), []);
  });

  test("grants one action across every page — a column", async () => {
    await db.query("delete from team_permissions where team_id = $1", [team]);
    const pages = (
      await db.query<{ key: string }>("select key from app_pages where is_permission_scope")
    ).rows.map((r) => r.key);
    await db.query("select admin_set_permissions($1, $2, $3::text[], array['view'], true)", [actor, team, pages]);
    const pairs = await granted();
    assert.equal(pairs.length, pages.length);
    assert.ok(pairs.every((p) => p.endsWith(":view")));
  });

  test("granting twice is not an error, and changes nothing the second time", async () => {
    await db.query("delete from team_permissions where team_id = $1", [team]);
    for (let i = 0; i < 2; i++) {
      await db.query("select admin_set_permissions($1, $2, array['records'], array['view','manage'], true)", [actor, team]);
    }
    assert.deepEqual(await granted(), ["records:manage", "records:view"]);
  });
});
