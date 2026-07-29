"use client";

import { useRouter } from "next/navigation";
import { buildHref, type ReportQuery, type FilterOption } from "./report-filters";

/**
 * The single-choice filters, as dropdowns rather than chips — a fiscal year
 * or a month has one answer, and a list of vendors can run long.
 *
 * Client-side only to navigate on change; the values themselves still live
 * in the URL, so this is a shortcut for the same links the chips use rather
 * than a separate source of truth.
 */
export function FilterSelects({
  query,
  fiscalYears,
  months,
  vendors,
}: {
  query: ReportQuery;
  fiscalYears: FilterOption[];
  months: FilterOption[];
  vendors: FilterOption[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <Field
        label="Fiscal year"
        value={String(query.fy)}
        options={fiscalYears}
        onChange={(v) =>
          // Changing year clears the month: the months listed belong to the
          // year on screen, so carrying one across would select nothing.
          router.push(buildHref(query, { fy: Number(v), month: "" }))
        }
      />
      <Field
        label="Month"
        value={query.month}
        options={[{ value: "", label: "Whole year" }, ...months]}
        onChange={(v) => router.push(buildHref(query, { month: v }))}
      />
      <Field
        label="Vendor"
        value={query.vendor}
        options={[{ value: "", label: "All vendors" }, ...vendors]}
        onChange={(v) => router.push(buildHref(query, { vendor: v }))}
      />
    </div>
  );
}

function Field({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-ink/55">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input max-w-[13rem] text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
