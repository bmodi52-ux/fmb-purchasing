"use client";

/** How many rows a page of a long list holds; the first is what a list opens at. */
export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * The foot of a long list: how many rows to a page, which rows these are, and
 * the way to the next ones.
 *
 * Approvals drew every waiting expense on one page — 141 of them was a scroll
 * of some forty screens on a phone. A page of 25 is a screen or two, and
 * whoever would rather scroll can ask for 50 or 100.
 */
export function Pager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  className = "",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pages"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-support text-ink/70 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <div role="group" aria-label="Rows per page" className="segmented">
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={size === pageSize}
              onClick={() => onPageSize(size)}
              className="segment tabular-nums pointer-coarse:py-2"
            >
              {size}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 tabular-nums">
        <span>
          {from.toLocaleString("en-AU")}–{to.toLocaleString("en-AU")} of {total.toLocaleString("en-AU")}
        </span>
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="btn btn-secondary btn-sm pointer-coarse:min-h-10"
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="btn btn-secondary btn-sm pointer-coarse:min-h-10"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
