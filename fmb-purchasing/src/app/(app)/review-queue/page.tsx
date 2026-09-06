import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { loadReviewQueue, type QueueItemKind } from "./data";

const GROUPS: { kind: QueueItemKind; heading: string; why: string }[] = [
  {
    kind: "unallocated_line",
    heading: "Spend with nothing said about it",
    why: "The receipt total is right, but part of it was never itemised. Someone needs to say what it was for.",
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
];

export default async function ReviewQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "review_queue", "view");

  const { items, counts } = await loadReviewQueue();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Needs attention</h1>
        <p className="page-description mt-1 max-w-2xl">
          Everything currently waiting on a person&rsquo;s judgement. Each of these was visible
          somewhere already — this is the list you can actually work through and finish.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-palm/30 bg-palm/5 px-4 py-8 text-center text-sm text-ink/70">
          Nothing needs a decision right now.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {GROUPS.map((group) => {
            const groupItems = items.filter((i) => i.kind === group.kind);
            if (groupItems.length === 0) return null;

            return (
              <section key={group.kind}>
                <div className="mb-1 flex items-baseline gap-3">
                  <h2 className="section-title text-ink">{group.heading}</h2>
                  <span className="font-mono text-sm text-ink/50">{counts[group.kind]}</span>
                </div>
                <p className="page-description mb-3 max-w-2xl">{group.why}</p>

                <ul className="divide-y divide-ink/5 overflow-hidden rounded-lg border border-ink/10 bg-white/60">
                  {groupItems.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-gold/10"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-ink/55">{item.detail}</span>
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-ink/30">
                          →
                        </span>
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
