import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import { accessChangeActor, describeAccessChange, type AccessChangeRow } from "./access-changes.ts";

/**
 * The access-change record — migration 0045.
 *
 * Recorded by triggers so nothing that changes access can skip it, with the
 * actor supplied by the admin_* functions. What matters: every kind of change
 * lands, the actor is right, and cascades from deleting a team or a person are
 * not blocked by the record they leave.
 */

let db: TestDb;
let adminId: string;
let memberId: string;

before(async () => {
  db = await createTestDb();
  adminId = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('admin@test.local', '{"full_name": "Admin Person"}'::jsonb) returning id`
  );
  memberId = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('member@test.local', '{"full_name": "Member Person"}'::jsonb) returning id`
  );
});

after(async () => {
  await db?.close();
});

async function latest(kind: string) {
  const result = await db.query<AccessChangeRow & { team_id: string | null; subject_id: string | null }>(
    "select * from access_changes where kind = $1 order by changed_at desc, id desc limit 1",
    [kind]
  );
  return result.rows[0];
}

describe("access_changes", () => {
  test("a new account joining the default team is recorded as automatic", async () => {
    const row = await latest("member_added");
    assert.ok(row);
    assert.equal(row.actor_id, null);
    assert.match(row.detail ?? "", /^Automatically/);
    assert.equal(accessChangeActor(row, () => undefined), "Automatic");
  });

  test("creating a team, adding a member and granting a permission name the admin", async () => {
    const teamId = await scalar<string>(db, "select admin_create_team($1, 'Treasury')", [adminId]);
    await db.query("select admin_set_membership($1, $2, $3, true)", [adminId, teamId, memberId]);
    await db.query("select admin_set_permission($1, $2, 'payments', 'mark_paid', true)", [adminId, teamId]);

    const created = await latest("team_created");
    assert.equal(created.actor_id, adminId);
    assert.equal(created.team_name, "Treasury");

    const added = await latest("member_added");
    assert.equal(added.actor_id, adminId);
    assert.equal(added.subject_name, "Member Person");
    assert.equal(added.detail, null);

    const granted = await latest("permission_granted");
    assert.equal(granted.actor_id, adminId);
    assert.equal(granted.page_key, "payments");
    assert.equal(
      describeAccessChange(granted, { page: () => "Payments", action: () => "Mark paid" }),
      "Gave “Treasury” Mark paid on Payments"
    );
  });

  test("revoking and removing are recorded too", async () => {
    const teamId = await scalar<string>(db, "select id from teams where name = 'Treasury'");
    await db.query("select admin_set_permission($1, $2, 'payments', 'mark_paid', false)", [adminId, teamId]);
    await db.query("select admin_set_membership($1, $2, $3, false)", [adminId, teamId, memberId]);
    assert.equal((await latest("permission_revoked")).actor_id, adminId);
    assert.equal((await latest("member_removed")).subject_id, memberId);
  });

  test("a change made directly, outside the app, has no actor", async () => {
    const teamId = await scalar<string>(db, "select id from teams where name = 'Treasury'");
    await db.query("insert into team_permissions (team_id, page_key, action_key) values ($1, 'reports', 'view')", [teamId]);
    const row = await latest("permission_granted");
    assert.equal(row.actor_id, null);
    assert.equal(accessChangeActor(row, () => undefined), "Outside the app");
  });

  test("the actor does not leak into the next transaction", async () => {
    const teamId = await scalar<string>(db, "select id from teams where name = 'Treasury'");
    await db.query("select admin_set_permission($1, $2, 'vendors', 'view', true)", [adminId, teamId]);
    await db.query("delete from team_permissions where team_id = $1 and page_key = 'vendors'", [teamId]);
    assert.equal((await latest("permission_revoked")).actor_id, null);
  });

  test("deactivating an account is recorded, and only on a real change", async () => {
    await db.query("select admin_set_active($1, $2::uuid[], false)", [adminId, [memberId]]);
    await db.query("select admin_set_active($1, $2::uuid[], false)", [adminId, [memberId]]);
    assert.equal(
      await scalar<number>(db, "select count(*)::int from access_changes where kind = 'account_deactivated'"),
      1
    );
  });

  test("stand-in nominations are a kind of access change (0051), and a stand-in can't be yourself", async () => {
    await db.query(
      "insert into access_changes (actor_id, kind, subject_id, subject_name, detail) values ($1, 'stand_in_nominated', $2, 'Member Person', 'Covering approving')",
      [adminId, memberId]
    );
    await assert.rejects(
      db.query(
        "insert into stand_ins (user_id, stand_in_id, duty, starts_on, ends_on) values ($1, $1, 'approve', '2026-09-01', '2026-09-02')",
        [adminId]
      )
    );
    await assert.rejects(
      db.query(
        "insert into stand_ins (user_id, stand_in_id, duty, starts_on, ends_on) values ($1, $2, 'approve', '2026-09-05', '2026-09-02')",
        [adminId, memberId]
      )
    );
  });

  test("deleting a team with members and grants is not blocked by the record", async () => {
    const teamId = await scalar<string>(db, "select admin_create_team($1, 'Short-lived')", [adminId]);
    await db.query("select admin_set_membership($1, $2, $3, true)", [adminId, teamId, adminId]);
    await db.query("select admin_set_permission($1, $2, 'reports', 'view', true)", [adminId, teamId]);
    await db.query("delete from teams where id = $1", [teamId]);
    const deleted = await latest("team_deleted");
    assert.equal(deleted.team_name, "Short-lived");
    assert.equal(
      await scalar<number>(db, "select count(*)::int from access_changes where team_id = $1", [teamId]),
      0
    );
  });
});
