import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { reportError } from "@/lib/errors";
import { userCan } from "@/lib/permissions";
import { todayIso } from "@/lib/periods-data";
import { findReport } from "@/lib/reporting/registry";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { documentToPdf } from "@/lib/reporting/pdf";
import { documentToCsv } from "@/lib/reporting/tables";
import { documentToXlsx } from "@/lib/reporting/xlsx";

/** The logo for a PDF's header; without it the header is words alone. */
async function logoDataUrl(): Promise<string | null> {
  try {
    const png = await readFile(path.join(process.cwd(), "public", "fmb-logo.png"));
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Downloads: any report in lib/reporting/registry, as CSV, Excel or PDF, built on
 * the server from the same loader and the same URL parameters as its page —
 * so what is downloaded is what was on screen.
 *
 *   /reports/export?report=spend&format=xlsx&period=au2026&section=breakdown…
 *   /reports/export?report=budgets&format=csv&period=h1448
 *   /reports/export?report=gst&format=xlsx&period=au2026-q1&basis=paid
 *
 * The page's own permission is checked here as well, since a download is the
 * page's data without the page.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download reports.", { status: 401 });

  const search = request.nextUrl.searchParams;
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    const values = search.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }

  const report = findReport(search.get("report") ?? undefined);
  if (!report) return new Response("There is no such report.", { status: 404 });
  if (!(await userCan(user, report.permission.page, report.permission.action))) {
    return new Response("You don't have access to this report.", { status: 403 });
  }

  const asked = search.get("format");
  const format = asked === "csv" || asked === "pdf" ? asked : "xlsx";
  try {
    const doc = await report.build(params, todayIso());
    const headers = {
      "Content-Disposition": `attachment; filename="${doc.filenameBase}.${format}"`,
      "Cache-Control": "no-store",
    };
    if (format === "csv") {
      return new Response(documentToCsv(doc), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
    }
    if (format === "pdf") {
      return new Response(Buffer.from(documentToPdf(doc, await logoDataUrl())), {
        headers: { ...headers, "Content-Type": "application/pdf" },
      });
    }
    return new Response(Buffer.from(await documentToXlsx(doc)), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  } catch (error) {
    await reportError({
      source: "report-export",
      error: error instanceof Error ? error.message : String(error),
      userId: user.id,
    });
    return new Response("The file couldn't be made. Try again.", { status: 500 });
  }
}
