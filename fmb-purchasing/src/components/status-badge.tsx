/**
 * Where a record stands, said the same way on every page that shows one (#23).
 *
 * Each list used to colour its own: a pill on expenses, bare green text on the
 * pricelist, bare gold on vendors. The tone is what a status means to whoever
 * is reading — waiting on someone, settled, turned down, out of play — so an
 * unknown word still gets a sensible neutral.
 */
const TONE: Record<string, "waiting" | "good" | "bad" | "muted"> = {
  submitted: "waiting",
  pending: "waiting",
  approved: "good",
  active: "good",
  declined: "bad",
  rejected: "bad",
  withdrawn: "muted",
  retired: "muted",
  disabled: "muted",
};

export function StatusBadge({ status, label }: { status: string; label?: React.ReactNode }) {
  const tone = TONE[status.toLowerCase()];
  return <span className={`badge${tone ? ` badge-${tone}` : ""}`}>{label ?? status}</span>;
}
