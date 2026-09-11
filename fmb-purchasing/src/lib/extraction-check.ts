import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "@/lib/app-settings";
import { leafCategories } from "@/lib/categories";
import { RECEIPTS_BUCKET, sha256Hex } from "@/lib/receipt-storage";
import { extractReceiptDetailed, RECEIPT_MODEL } from "@/lib/receipt-extraction";
import {
  accuracy,
  readingGotWorse,
  scoreReading,
  totalsOf,
  type Check,
  type ExpectedReceipt,
} from "@/lib/extraction-scoring";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";

/**
 * The scheduled receipt-reading check (#49, migration 0054).
 *
 * Receipts whose correct values someone confirmed are read again with the
 * app's own reader every `everyDays`, a few each morning inside the daily job
 * — a Vercel function has minutes, not the half hour a whole set can take. When
 * a run finishes it is compared with the one before, and admins are told if
 * the reading got worse: the usual cause is a change of AI model.
 *
 * The receipts are loaded once with scripts/load-extraction-check.mjs.
 */

export type CheckSummary =
  | { state: "off" | "no_receipts" | "not_due" }
  | { state: "read"; runId: string; read: number; remaining: number; finished: boolean; accuracy?: number | null };

const PARALLEL = 3;

async function readOne(
  admin: SupabaseClient,
  runId: string,
  testCase: { id: string; storage_path: string; content_type: string; sha256: string; expected: ExpectedReceipt },
  categoryNames: string[]
): Promise<void> {
  let checks: Check[] = [];
  let passed = 0;
  let total = 0;
  let error: string | null = null;
  try {
    const { data, error: downloadError } = await admin.storage.from(RECEIPTS_BUCKET).download(testCase.storage_path);
    if (downloadError || !data) throw new Error(downloadError?.message ?? "The receipt file is missing.");
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (sha256Hex(bytes) !== testCase.sha256) throw new Error("The receipt file no longer matches.");
    const detail = await extractReceiptDetailed(Buffer.from(bytes).toString("base64"), testCase.content_type, categoryNames);
    ({ checks, passed, total } = scoreReading(detail.receipt, testCase.expected));
  } catch (err) {
    error = (err as Error).message.slice(0, 500);
  }
  await admin
    .from("extraction_benchmark_results")
    .upsert({ run_id: runId, case_id: testCase.id, checks, passed, total, error, read_at: new Date().toISOString() });
}

export async function continueExtractionCheck(admin: SupabaseClient, options?: { force?: boolean }): Promise<CheckSummary> {
  const settings = await getSetting(admin, "extraction_check");
  if (!settings.enabled && !options?.force) return { state: "off" };

  const { data: cases } = await admin
    .from("extraction_benchmark_cases")
    .select("id, storage_path, content_type, sha256, expected")
    .eq("active", true)
    .order("file_name");
  if (!cases?.length) return { state: "no_receipts" };

  let { data: run } = await admin
    .from("extraction_benchmark_runs")
    .select("id, case_count")
    .is("finished_at", null)
    .maybeSingle();

  if (!run) {
    const { data: last } = await admin
      .from("extraction_benchmark_runs")
      .select("started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dueAfter = last ? new Date(last.started_at as string).getTime() + settings.everyDays * 86_400_000 : 0;
    if (!options?.force && Date.now() < dueAfter) return { state: "not_due" };

    const { data: created, error } = await admin
      .from("extraction_benchmark_runs")
      .insert({ model: RECEIPT_MODEL, case_count: cases.length })
      .select("id, case_count")
      .single();
    // Another call opened one first; it will do the reading.
    if (error || !created) return { state: "not_due" };
    run = created;
  }
  const runId = run.id as string;

  const { data: done } = await admin.from("extraction_benchmark_results").select("case_id").eq("run_id", runId);
  const doneIds = new Set((done ?? []).map((d) => d.case_id as string));
  const pending = cases.filter((c) => !doneIds.has(c.id as string)).slice(0, Math.max(1, settings.perMorning));

  if (pending.length) {
    const { data: categories } = await admin.from("categories").select("id, name, parent_category_id").order("sort_order");
    const names = leafCategories(categories ?? []).map((c) => c.name);
    for (let i = 0; i < pending.length; i += PARALLEL) {
      await Promise.all(
        pending.slice(i, i + PARALLEL).map((c) =>
          readOne(
            admin,
            runId,
            c as { id: string; storage_path: string; content_type: string; sha256: string; expected: ExpectedReceipt },
            names
          )
        )
      );
    }
  }

  const remaining = cases.length - doneIds.size - pending.length;
  if (remaining > 0) return { state: "read", runId, read: pending.length, remaining, finished: false };

  // Finished: total it up and compare with the last finished run.
  const { data: results } = await admin
    .from("extraction_benchmark_results")
    .select("checks, error")
    .eq("run_id", runId);
  const totals = totalsOf((results ?? []).map((r) => ({ checks: (r.checks as Check[]) ?? [] })));
  const failedCases = (results ?? []).filter((r) => r.error).length;

  await admin
    .from("extraction_benchmark_runs")
    .update({
      finished_at: new Date().toISOString(),
      checks: totals.checks,
      passed: totals.passed,
      failed_cases: failedCases,
      by_field: totals.byField,
    })
    .eq("id", runId);

  const { data: previous } = await admin
    .from("extraction_benchmark_runs")
    .select("checks, passed")
    .not("finished_at", "is", null)
    .neq("id", runId)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const worse = readingGotWorse(totals, previous ? { checks: Number(previous.checks), passed: Number(previous.passed) } : null, settings.alertDropPoints);
  if (worse || failedCases > 0) {
    const admins = await userIdsWithPermission(admin, "admin_users", "manage_users");
    const now = accuracy(totals);
    const before = previous ? accuracy({ checks: Number(previous.checks), passed: Number(previous.passed) }) : null;
    await notify(
      admin,
      admins.map((userId) => ({
        userId,
        kind: "system_error" as const,
        title: worse ? "Receipts are being read less accurately" : "Some check receipts could not be read",
        body: worse
          ? `${now}% of checked values were right, down from ${before}%. A change of AI model is the usual cause.`
          : `${failedCases} of ${cases.length} receipts in the reading check failed to read.`,
        link: "/admin/settings",
      }))
    );
  }

  return { state: "read", runId, read: pending.length, remaining: 0, finished: true, accuracy: accuracy(totals) };
}
