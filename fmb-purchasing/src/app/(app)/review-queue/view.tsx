import Link from "next/link";
import { loadReviewQueue, type QueueItemKind } from "./data";

const GROUPS: { kind: QueueItemKind; heading: string; why: string }[] = [
  {
    kind: "unallocated_line",
    heading: "Spend with nothing said about it",
    why: "The receipt total is right, but part of it was never itemised. Someone needs to say what it was for.",
  },
  {
    kind: "receipt_date",
    heading: "Receipt dates to check",
    why: "Dated after they were submitted, or more than a year before — most likely misread off the receipt. Until corrected they sit in the wrong month of every report.",
  },
  {
    kind: "uncategorised_line",
    heading: "Lines nobody has classified",
    why: "The reader could not tell what these were and said so rather than guessing. Until they are categorised they sit outside every report cut by category.",
  },
  {
    kind: "pending_vendor",
    heading: "New vendors",
    why: "Seen on a receipt but not yet part of the catalogue. Approve them, or merge them into the vendor they duplicate.",
  },
  {
    kind: "pending_item",
    heading: "New items",
    why: "Same, for products. A duplicate left unmerged splits one item's price history in two.",
  },
  {
    kind: "unconfirmed_pack",
    heading: "Unconfirmed pack contents",
    why: "How much is actually in the pack is not on the receipt. Until someone says, every per-unit cost derived from it is provisional.",
  },
  {
    kind: "old_price",
    heading: "Oldest prices",
    why: "Prices never expire, so these are still what costing and the buying list use. Past two months they are worth checking: a new receipt, a fresh link or a phone call updates them.",
  },
];

/**
 * Everything waiting on someone's judgement. The same for whoever may see the
 * page, so it takes nobody: page.tsx does the signing in.
 */
export async function ReviewQueueView() {
  const { items, counts } = await loadReviewQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Needs attention</h1>
        <p className="page-description mt-1 max-w-2xl">
          Everything waiting on someone&rsquo;s judgement, in one list to work through.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-palm/30 bg-palm/5 px-4 py-8 text-center text-body text-ink/70">
          Nothing needs a decision right now.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {GROUPS.map((group) => {
            const groupItems = items.filter((i) => i.kind === group.kind);
            if (groupItems.length === 0) return null;

            return (
              <section key={group.kind}>
                <div className="mb-1 flex items-center gap-2.5">
                  <h2 className="section-title text-ink">{group.heading}</h2>
                  {/* How many, as the count beside a filter says it. */}
                  <span className="badge tabular-nums">{counts[group.kind]}</span>
                </div>
                <p className="page-description mb-3 max-w-2xl">{group.why}</p>

                <ul className="card divide-y divide-ink/[0.06] overflow-hidden">
                  {groupItems.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-gold/[0.07]"
                      >
                        {/* Whole, on as many lines as it takes: a name cut short
                            on a phone was a row nobody could tell from the next. */}
                        <span className="min-w-0">
                          <span className="block text-body font-semibold break-words text-ink">{item.title}</span>
                          <span className="block text-support break-words text-ink/70">{item.detail}</span>
                        </span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 20 20"
                          fill="none"
                          aria-hidden="true"
                          className="shrink-0 text-ink/50"
                        >
                          <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
