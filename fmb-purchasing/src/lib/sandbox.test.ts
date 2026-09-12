import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sandboxRecipients, sandboxSubject, SANDBOX_SUBJECT_PREFIX } from "./sandbox.ts";
import { TRAINEES } from "./sandbox-trainees.ts";

describe("sandbox email", () => {
  const trainee = TRAINEES[0].email;

  test("only a trainee is written to; everyone else is held back", () => {
    const { send, held } = sandboxRecipients([trainee, "someone@sandbox.invalid", "real.vendor@example.com"]);
    assert.deepEqual(send, [trainee]);
    assert.deepEqual(held, ["someone@sandbox.invalid", "real.vendor@example.com"]);
  });

  test("a trainee is matched whatever the case or spacing", () => {
    const { send } = sandboxRecipients([` ${trainee.toUpperCase()} `]);
    assert.equal(send.length, 1);
  });

  test("the subject says where it came from, and says it once", () => {
    assert.equal(sandboxSubject("Expense approved"), `${SANDBOX_SUBJECT_PREFIX}Expense approved`);
    assert.equal(sandboxSubject(sandboxSubject("Expense approved")), `${SANDBOX_SUBJECT_PREFIX}Expense approved`);
  });

  test("every trainee has a real-looking address, or the sandbox emails nobody", () => {
    assert.ok(TRAINEES.length > 0, "at least one trainee, or nothing can sign in");
    for (const t of TRAINEES) {
      assert.match(t.email, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, t.email);
      assert.ok(!t.email.endsWith(".invalid"), "a trainee needs an address that can receive");
      assert.ok(t.teams.length > 0, `${t.email} needs at least one team`);
    }
  });
});
