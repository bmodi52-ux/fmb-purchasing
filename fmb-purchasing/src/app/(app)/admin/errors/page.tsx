import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { resolveError, resolveAllErrors } from "./actions";

const RESOLVED_SHOWN = 20;

type ErrorRow = {
  id: string;
  source: string;
  message: string;
  detail: string | null;
  user_id: string | null;
  expense_id: string | null;
  seen_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

export default async function ErrorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");

  const admin = createAdminClient();
  const [{ data: open }, { data: resolved }] = await Promise.all([
    admin
      .from("error_events")
      .select("*")
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false }),
    admin
      .from("error_events")
      .select("*")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(RESOLVED_SHOWN),
  ]);

  const openRows = (open ?? []) as ErrorRow[];
  const resolvedRows = (resolved ?? []) as ErrorRow[];

  const personIds = [
    ...new Set(
      [...openRows, ...resolvedRows].map((r) => r.user_id).filter(Boolean) as string[]
    ),
  ];
  const { data: people } = personIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", personIds)
    : { data: [] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email] as const));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title text-ink">System errors</h1>
        <p className="page-description mt-1 max-w-xl">
          Failures the app caught and handled without telling anyone at the time —
          a receipt that wouldn&apos;t extract, an email that didn&apos;t send. Repeats of
          the same fault are counted on one line rather than listed separately.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="section-title text-ink">
            Unresolved{openRows.length > 0 && ` (${openRows.length})`}
          </h2>
          {openRows.length > 0 && (
            <form action={resolveAllErrors}>
              <SubmitButton className="text-xs text-ink/60 hover:text-ink">
                Mark all resolved
              </SubmitButton>
            </form>
          )}
        </div>

        {openRows.length === 0 ? (
          <p className="rounded-lg border border-palm/30 bg-palm/5 px-4 py-3 text-sm text-ink/70">
            Nothing broken. This page stays empty unless something fails.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {openRows.map((row) => (
              <ErrorCard key={row.id} row={row} who={nameById} resolvable />
            ))}
          </ul>
        )}
      </section>

      {resolvedRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="section-title text-ink">Recently resolved</h2>
          <ul className="flex flex-col gap-3 opacity-60">
            {resolvedRows.map((row) => (
              <ErrorCard key={row.id} row={row} who={nameById} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ErrorCard({
  row,
  who,
  resolvable = false,
}: {
  row: ErrorRow;
  who: Map<string, string>;
  resolvable?: boolean;
}) {
  return (
    <li className="rounded-lg border border-ink/10 bg-white/60 p-4">
      {/* Not flex-wrap: a long single-line message would otherwise push the
          button onto its own row and left-align it, out of line with the
          other cards. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-xs text-ink/70">
              {row.source}
            </span>
            {row.seen_count > 1 && (
              <span className="text-xs text-maroon/80">{row.seen_count} times</span>
            )}
          </p>
          <p className="mt-1.5 break-words text-sm text-ink">{row.message}</p>
        </div>

        {resolvable && (
          <form action={resolveError}>
            <input type="hidden" name="error_id" value={row.id} />
            <SubmitButton className="whitespace-nowrap text-xs text-ink/60 hover:text-ink">
              Mark resolved
            </SubmitButton>
          </form>
        )}
      </div>

      <p className="mt-2 text-xs text-ink/50">
        {row.seen_count > 1
          ? `First ${formatDateTime(row.first_seen_at)} · last ${formatDateTime(row.last_seen_at)}`
          : formatDateTime(row.last_seen_at)}
        {row.user_id && ` · ${who.get(row.user_id) ?? "unknown user"}`}
        {row.expense_id && (
          <>
            {" · "}
            <Link href={`/expenses/${row.expense_id}`} className="underline">
              related expense
            </Link>
          </>
        )}
      </p>

      {row.detail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink/50 hover:text-ink">
            Details
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-ink/5 p-3 text-xs whitespace-pre-wrap break-words text-ink/70">
            {row.detail}
          </pre>
        </details>
      )}
    </li>
  );
}
