import { SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";

/**
 * Who is told about thaali buying, and when (#15).
 *
 * Pure, so the rules can be read and tested without a database: when
 * something has to be ordered by, whether it is overdue, and who has just
 * been given something to buy.
 */

/** Without a vendor saying otherwise, an order goes in the day before. */
export const DEFAULT_LEAD_DAYS = 1;

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last day to order for a thaali day, given the vendor's notice. */
export function orderByDate(serviceDate: string, leadDays: number | null | undefined): string {
  return shift(serviceDate, -(leadDays ?? DEFAULT_LEAD_DAYS));
}

export type BuyingLine = {
  status: "to_order" | "ordered" | "delivered" | "cancelled";
  serviceDate: string;
  leadDays: number | null;
};

/**
 * Whether something should have been ordered by now. Only what nobody has
 * ordered yet, and only for days still to come: a thaali day that has passed
 * is past nudging.
 */
export function isDue(line: BuyingLine, today: string): boolean {
  return line.status === "to_order" && line.serviceDate >= today && orderByDate(line.serviceDate, line.leadDays) <= today;
}

/** How pressing an order-by date is, for the list to show it. */
export function urgency(line: BuyingLine, today: string): "late" | "today" | "soon" | null {
  if (line.status !== "to_order" || line.serviceDate < today) return null;
  const by = orderByDate(line.serviceDate, line.leadDays);
  if (by < today) return "late";
  if (by === today) return "today";
  if (by <= shift(today, 2)) return "soon";
  return null;
}

export type Assignment = { itemId: string; ownerId: string | null; section: SectionKey };

/**
 * Who has just been given something to buy by a release: every owner of a
 * line that is new, or that was somebody else's before. Re-releasing a day
 * nobody's lists changed on tells nobody again.
 */
export function newlyAssigned(
  before: readonly Assignment[],
  after: readonly Assignment[]
): Map<string, { count: number; sections: SectionKey[] }> {
  const was = new Map(before.map((a) => [a.itemId, a.ownerId]));
  const out = new Map<string, { count: number; sections: SectionKey[] }>();
  for (const a of after) {
    if (!a.ownerId || was.get(a.itemId) === a.ownerId) continue;
    const entry = out.get(a.ownerId) ?? { count: 0, sections: [] };
    entry.count += 1;
    if (!entry.sections.includes(a.section)) entry.sections.push(a.section);
    out.set(a.ownerId, entry);
  }
  return out;
}

export function sectionList(sections: readonly SectionKey[]): string {
  return sections.map((s) => SECTION_LABEL[s]).join(", ");
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
