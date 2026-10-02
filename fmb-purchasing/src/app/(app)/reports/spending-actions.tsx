"use client";

import { useCallback, useState } from "react";
import { DownloadLinks } from "@/components/download-links";
import { SECTIONS, SPENDING_PATH, buildHref, type ReportQuery } from "@/lib/reporting/query";
import type { SavedReportView } from "@/lib/saved-report-views";
import { PrintPanel } from "./print-button";
import { SavedViews } from "./saved-views";

/**
 * The download of what is on screen: the same URL, sent to reports/export,
 * which builds the file on the server from the same figures.
 */
function exportHref(query: ReportQuery): string {
  return buildHref(query, {}).replace(`${SPENDING_PATH}?`, "/reports/export?report=spend&");
}

/**
 * What can be done with the Spending report as a whole, beside its name:
 * keep the way it is set up as a saved view, or take it away — as Excel, CSV
 * or PDF of its figures, or printed as a picture of the page.
 *
 * Print is the last choice under Download rather than a button of its own:
 * it is one more way of taking the report away, and the row of four buttons
 * it made with the formats was most of the header.
 */
export function SpendingActions({
  query,
  summary,
  empty,
  savedViews,
  userId,
  teams,
}: {
  query: ReportQuery;
  /** Period, filters and basis in one line — the heading of anything printed. */
  summary: string;
  /** Nothing in the period: there is nothing to download or print. */
  empty: boolean;
  savedViews: SavedReportView[];
  userId: string;
  teams: { id: string; name: string }[];
}) {
  const [printing, setPrinting] = useState(false);
  const closePrint = useCallback(() => setPrinting(false), []);
  const sectionLabel = SECTIONS.find((s) => s.key === query.section)?.label ?? query.section;

  return (
    <>
      <SavedViews views={savedViews} query={query} userId={userId} teams={teams} />
      {!empty && (
        <div className="relative">
          <DownloadLinks href={exportHref(query)}>
            {(close) => (
              <button
                type="button"
                onClick={() => {
                  close();
                  setPrinting(true);
                }}
                className="rounded border-t border-ink/10 px-3 py-2 text-left hover:bg-gold/10"
              >
                <span className="block text-body font-medium text-ink">Print</span>
                <span className="block text-support text-ink/70">A picture of the page, charts and all</span>
              </button>
            )}
          </DownloadLinks>
          {printing && (
            <PrintPanel
              title={`Spending — ${sectionLabel}`}
              subtitle={summary}
              filenameBase={`reports-${query.section}-${query.period}`}
              onClose={closePrint}
            />
          )}
        </div>
      )}
    </>
  );
}
