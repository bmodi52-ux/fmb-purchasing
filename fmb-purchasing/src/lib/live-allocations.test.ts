import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { liveAllocations } from "./live-allocations.ts";

/**
 * The filter runs in PostgREST, which the test database doesn't have, so this
 * pins the request instead: the embed is inner at both levels — otherwise the
 * filter would blank the nested expense and keep the allocation — and the
 * statuses left out are exactly the ones that aren't spend.
 */
function recordingClient(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder = {
    select: (...args: unknown[]) => (calls.push({ method: "select", args }), builder),
    in: (...args: unknown[]) => (calls.push({ method: "in", args }), builder),
    not: (...args: unknown[]) => (calls.push({ method: "not", args }), Promise.resolve({ data: rows, error: null })),
  };
  const client = { from: (table: string) => (calls.push({ method: "from", args: [table] }), builder) };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("liveAllocations", () => {
  test("asks only for allocations whose expense still counts as spend", async () => {
    const { client, calls } = recordingClient([]);
    await liveAllocations(client, ["r1"]);

    const select = String(calls.find((c) => c.method === "select")!.args[0]);
    assert.match(select, /expense_line_items!inner \( expenses!inner \( status \) \)/);
    assert.deepEqual(calls.find((c) => c.method === "not")!.args, [
      "expense_line_items.expenses.status",
      "in",
      "(declined,withdrawn)",
    ]);
  });

  test("returns numbers, not the strings numeric columns arrive as", async () => {
    const { client } = recordingClient([
      { menu_requirement_id: "r1", quantity: "2.500", amount: "18.75", expense_line_items: {} },
    ]);
    assert.deepEqual(await liveAllocations(client, ["r1"]), [{ menu_requirement_id: "r1", quantity: 2.5, amount: 18.75 }]);
  });

  test("no requirements, no request", async () => {
    const { client, calls } = recordingClient([]);
    assert.deepEqual(await liveAllocations(client, []), []);
    assert.equal(calls.length, 0);
  });
});
