"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Dialog } from "@/components/dialog";
import { SubmitButton } from "@/components/submit-button";
import { buildHref, type ReportQuery } from "./report-filters";
import { SHARING_LABELS, type SavedReportView, type ViewSharing } from "@/lib/saved-report-views";
import { copyReportView, deleteReportView, saveReportView, type SavedViewState } from "./saved-views-actions";

type Team = { id: string; name: string };

/**
 * Saved report views (#41): open one, save what is on screen, and — for your
 * own — rename, reshare, update or delete. Views shared with you can be copied
 * to make your own version.
 */
export function SavedViews({
  views,
  query,
  userId,
  teams,
}: {
  views: SavedReportView[];
  query: ReportQuery;
  userId: string;
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);
  const here = buildHref(query, {});
  const current = views.find((v) => buildHref(v.query, {}) === here);
  const own = views.filter((v) => v.ownerId === userId);
  const shared = views.filter((v) => v.ownerId !== userId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-ink/15 px-3.5 py-1.5 text-sm text-ink/75 hover:border-ink/30 hover:text-ink"
      >
        {current ? <>View: {current.name}</> : <>Saved views{views.length ? ` (${views.length})` : ""}</>}
      </button>

      {open && (
        <Dialog title="Saved views" onClose={() => setOpen(false)} align="start">
          <div className="flex flex-col gap-6 text-sm">
            <ViewForm
              key={`new-${here}`}
              teams={teams}
              query={query}
              submitLabel="Save what's on screen"
              heading="Save this report as a view"
            />

            <ViewList title="Your views" empty="You haven't saved any yet.">
              {own.map((v) => (
                <li key={v.id} className="flex flex-col gap-2 py-2.5">
                  <ViewSummary view={v} teams={teams} current={v.id === current?.id} showOwner={false} onOpen={() => setOpen(false)} />
                  <details>
                    <summary className="cursor-pointer text-xs text-ink/55 hover:text-ink">Change, reshare or delete</summary>
                    <div className="mt-2 flex flex-col gap-3 rounded-md border border-ink/10 bg-white/60 p-3">
                      <ViewForm key={`${v.id}-${v.updatedAt}`} view={v} teams={teams} query={query} submitLabel="Save changes" />
                      <form action={deleteReportView}>
                        <input type="hidden" name="view_id" value={v.id} />
                        <SubmitButton pendingLabel="Deleting…" className="text-xs text-maroon/80 underline hover:text-maroon">
                          Delete this view
                        </SubmitButton>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ViewList>

            {shared.length > 0 && (
              <ViewList title="Shared with you" empty="">
                {shared.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <ViewSummary view={v} teams={teams} current={v.id === current?.id} showOwner onOpen={() => setOpen(false)} />
                    <form action={copyReportView}>
                      <input type="hidden" name="view_id" value={v.id} />
                      <SubmitButton pendingLabel="Copying…" className="text-xs text-ink/60 underline hover:text-ink">
                        Copy to my views
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ViewList>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

function ViewList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink/45">{title}</h3>
      {children.length === 0 ? (
        <p className="text-ink/50">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-ink/5">{children}</ul>
      )}
    </section>
  );
}

function sharingText(view: SavedReportView, teams: Team[]): string {
  if (view.sharedWith !== "teams") return SHARING_LABELS[view.sharedWith];
  const names = view.teamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean);
  return names.length ? `Shared with ${names.join(", ")}` : "Shared with teams since removed";
}

function ViewSummary({
  view,
  teams,
  current,
  showOwner,
  onOpen,
}: {
  view: SavedReportView;
  teams: Team[];
  current: boolean;
  showOwner: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="min-w-0">
      <Link href={buildHref(view.query, {})} onClick={onOpen} className="font-medium text-ink underline-offset-2 hover:underline">
        {view.name}
      </Link>
      {current && <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs text-gold-deep">on screen</span>}
      <p className="text-xs text-ink/55">
        {showOwner ? `Saved by ${view.ownerName}` : sharingText(view, teams)}
      </p>
    </div>
  );
}

function ViewForm({
  view,
  teams,
  query,
  submitLabel,
  heading,
}: {
  view?: SavedReportView;
  teams: Team[];
  query: ReportQuery;
  submitLabel: string;
  heading?: string;
}) {
  const [state, action, pending] = useActionState<SavedViewState, FormData>(saveReportView, { status: "idle" });
  const [sharing, setSharing] = useState<ViewSharing>(view?.sharedWith ?? "private");

  return (
    <form action={action} className="flex flex-col gap-3">
      {heading && <p className="section-title text-ink">{heading}</p>}
      {view && <input type="hidden" name="view_id" value={view.id} />}
      <input type="hidden" name="query" value={JSON.stringify(query)} />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink/60">Name</span>
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={view?.name ?? ""}
          placeholder="Meat this year, by vendor"
          className="input"
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-ink/60">Who can open it</legend>
        {(Object.keys(SHARING_LABELS) as ViewSharing[]).map((key) => (
          <label key={key} className="flex items-center gap-2">
            <input type="radio" name="shared_with" value={key} checked={sharing === key} onChange={() => setSharing(key)} />
            {SHARING_LABELS[key]}
          </label>
        ))}
        {sharing === "teams" && (
          <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1.5">
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="team_ids" value={t.id} defaultChecked={view?.teamIds.includes(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-ink/45">
          Anyone it&apos;s shared with can open it or copy it; only you can change or delete it.
        </p>
      </fieldset>

      {view && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="replace_query" />
          Also change it to the report on screen now
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {state.status !== "idle" && (
          <p role="status" className={`text-sm ${state.status === "error" ? "text-maroon" : "text-palm"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
