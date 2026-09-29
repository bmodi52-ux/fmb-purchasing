/**
 * Excel and CSV downloads of a report (reports/export). `href` is the export
 * URL without a format; each link adds its own. Plain links, so a download
 * needs no script and the browser shows its own progress.
 */
export function DownloadLinks({ href, label }: { href: string; label?: string }) {
  const pill =
    "rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/65 transition-colors hover:border-ink/30 hover:text-ink";
  const sep = href.includes("?") ? "&" : "?";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-ink/55">{label}</span>}
      <a href={`${href}${sep}format=xlsx`} download className={pill}>
        Excel
      </a>
      <a href={`${href}${sep}format=csv`} download className={pill}>
        CSV
      </a>
    </div>
  );
}
