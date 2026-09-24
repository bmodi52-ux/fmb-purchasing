"use client";

import { useMemo, useState } from "react";
import { ExportToolbar } from "@/components/export-toolbar";
import { formatPlainDate } from "@/lib/format";
import type { SectionKey } from "@/lib/menu-sections";

type Line = {
  id: string;
  serviceDate: string;
  kitchenName: string;
  section: SectionKey;
  itemId: string;
  itemName: string;
  quantity: number;
  outstanding: number;
  unit: string;
  packTitle: string | null;
  packs: number | null;
  /** The cheapest store and what to buy there, at today's prices (#29). */
  cheapest: { vendorName: string; what: string; onSpecial: boolean } | null;
  vendorName: string | null;
  status: "to_order" | "ordered" | "delivered" | "cancelled";
};

/**
 * One list per section, over the days chosen (#70).
 *
 * Ticking a day is the whole interaction: a butcher's order covers Friday and
 * Monday together, so the quantities add up, and the days each item is for
 * stay beside it. Ticking an item off as it goes in the trolley is browser-
 * side only — what was actually bought is the receipt, not a tick.
 */
export function ShoppingLists({
  lines,
  days,
  sections,
}: {
  lines: Line[];
  days: string[];
  sections: { key: SectionKey; label: string }[];
}) {
  const [chosenDays, setChosenDays] = useState<Set<string>>(new Set(days));
  const [chosenSections, setChosenSections] = useState<Set<SectionKey>>(new Set(sections.map((s) => s.key)));
  const [openOnly, setOpenOnly] = useState(true);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // One list per store instead of per section, for a trip to each (#29).
  const [byStore, setByStore] = useState(false);

  const shown = useMemo(
    () =>
      lines.filter(
        (l) =>
          chosenDays.has(l.serviceDate) &&
          chosenSections.has(l.section) &&
          (!openOnly || l.status !== "delivered")
      ),
    [lines, chosenDays, chosenSections, openOnly]
  );

  // One row per item per section: the same onions across three days is one
  // thing to buy, with the days it is for beside it.
  const rows = useMemo(() => {
    const byItem = new Map<
      string,
      {
        section: SectionKey;
        itemName: string;
        unit: string;
        quantity: number;
        days: string[];
        vendors: Set<string>;
        packTitle: string | null;
        cheapest: Line["cheapest"];
      }
    >();
    for (const line of shown) {
      const key = `${line.section}:${line.itemId}`;
      const existing = byItem.get(key);
      const quantity = openOnly && line.outstanding > 0 ? line.outstanding : line.quantity;
      if (existing) {
        existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
        if (!existing.days.includes(line.serviceDate)) existing.days.push(line.serviceDate);
        if (line.vendorName) existing.vendors.add(line.vendorName);
      } else {
        byItem.set(key, {
          section: line.section,
          itemName: line.itemName,
          unit: line.unit,
          quantity,
          days: [line.serviceDate],
          vendors: new Set(line.vendorName ? [line.vendorName] : []),
          packTitle: line.packTitle,
          cheapest: line.cheapest,
        });
      }
    }
    return [...byItem.entries()]
      .map(([key, value]) => ({ key, ...value, days: value.days.sort() }))
      .sort((a, b) => a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" }));
  }, [shown, openOnly]);

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 card p-4 text-sm print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink/55">Days:</span>
          {days.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setChosenDays((s) => toggle(s, day))}
              aria-pressed={chosenDays.has(day)}
              className={`rounded-md border px-3 py-1.5 ${
                chosenDays.has(day) ? "border-gold-deep bg-gold/10 text-ink" : "border-ink/15 text-ink/55"
              }`}
            >
              {formatPlainDate(day)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink/55">Lists:</span>
          {sections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setChosenSections((s) => toggle(s, section.key))}
              aria-pressed={chosenSections.has(section.key)}
              className={`rounded-md border px-3 py-1.5 ${
                chosenSections.has(section.key) ? "border-gold-deep bg-gold/10 text-ink" : "border-ink/15 text-ink/55"
              }`}
            >
              {section.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-ink/70">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Only what is still to buy
          </label>
          <label className="flex items-center gap-2 text-ink/70">
            <input type="checkbox" checked={byStore} onChange={(e) => setByStore(e.target.checked)} />
            Group by cheapest store
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ExportToolbar
            filenameBase="shopping-list"
            title="Shopping list"
            columns={[
              { key: "section", label: "List" },
              { key: "item", label: "Item" },
              { key: "quantity", label: "Quantity" },
              { key: "order", label: "To order" },
              { key: "days", label: "For" },
              { key: "vendor", label: "Vendor" },
              { key: "cheapest", label: "Cheapest at" },
            ]}
            rows={rows.map((row) => ({
              section: sections.find((s) => s.key === row.section)?.label ?? row.section,
              item: row.itemName,
              quantity: `${row.quantity} ${row.unit}`,
              order: row.packTitle ?? "",
              days: row.days.map(formatPlainDate).join(", "),
              vendor: [...row.vendors].join(", "),
              cheapest: row.cheapest ? `${row.cheapest.what} — ${row.cheapest.vendorName}` : "",
            }))}
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="btn btn-secondary btn-sm"
          >
            Print
          </button>
        </div>
      </div>

      {(byStore
        ? [...new Set(rows.map(storeOf))].sort().map((store) => ({ key: store, label: store, match: (r: (typeof rows)[number]) => storeOf(r) === store }))
        : sections
            .filter((section) => chosenSections.has(section.key))
            .map((section) => ({ key: section.key as string, label: section.label, match: (r: (typeof rows)[number]) => r.section === section.key }))
      )
        .filter((group) => rows.some(group.match))
        .map((group) => (
          <section key={group.key} className="card p-4">
            <h2 className="mb-3 section-title text-ink">{group.label}</h2>
            <ul className="flex flex-col gap-1">
              {rows
                .filter(group.match)
                .map((row) => (
                  <li key={row.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-ink/5 py-2 last:border-0">
                    <label className="flex flex-1 items-baseline gap-2">
                      <input
                        type="checkbox"
                        checked={ticked.has(row.key)}
                        onChange={() => setTicked((s) => toggle(s, row.key))}
                        className="print:hidden"
                        aria-label={`Got ${row.itemName}`}
                      />
                      <span className={`text-base ${ticked.has(row.key) ? "text-ink/40 line-through" : "text-ink"}`}>
                        {row.itemName}
                      </span>
                    </label>
                    <span className="tabular-nums text-base text-ink">
                      {row.quantity} {row.unit}
                    </span>
                    <span className="w-full text-xs text-ink/50 sm:w-auto">
                      {row.days.map(formatPlainDate).join(", ")}
                      {row.vendors.size > 0 && ` · ${[...row.vendors].join(", ")}`}
                    </span>
                    {row.cheapest && (
                      <span className="w-full text-xs text-ink/70">
                        Cheapest: {row.cheapest.what ? `${row.cheapest.what} at ` : "at "}
                        <span className="font-medium text-ink">{row.cheapest.vendorName}</span>
                        {row.cheapest.onSpecial && <span className="text-palm"> · on special</span>}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}

      {rows.length === 0 && <p className="text-sm text-ink/55">Nothing on the lists you have chosen.</p>}
    </div>
  );
}

/** Where a row is cheapest to buy, or the vendor it was given to, or anywhere. */
function storeOf(row: { cheapest: { vendorName: string } | null; vendors: Set<string> }): string {
  return row.cheapest?.vendorName ?? [...row.vendors][0] ?? "Anywhere";
}
