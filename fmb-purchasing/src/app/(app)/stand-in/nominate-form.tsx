"use client";

import { useActionState } from "react";
import { nominateStandIn, type NominateState } from "./actions";

export function NominateForm({
  duties,
  people,
  today,
  inAWeek,
}: {
  duties: { duty: string; label: string }[];
  people: { id: string; label: string }[];
  today: string;
  inAWeek: string;
}) {
  const [state, action, pending] = useActionState<NominateState, FormData>(nominateStandIn, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-xs text-ink/55">What they&apos;ll cover</legend>
        {duties.map((d) => (
          <label key={d.duty} className="flex items-center gap-2">
            <input type="checkbox" name="duty" value={d.duty} defaultChecked={duties.length === 1} />
            {d.label}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Stand-in</span>
        <select name="stand_in_id" required defaultValue="" className="input max-w-sm text-sm">
          <option value="" disabled>
            Choose someone
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/55">From</span>
          <input type="date" name="starts_on" required min={today} defaultValue={today} className="input text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink/55">To, including</span>
          <input type="date" name="ends_on" required min={today} defaultValue={inAWeek} className="input text-sm" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep disabled:opacity-60">
          {pending ? "Saving…" : "Name stand-in"}
        </button>
        {state.message && <p className={`text-xs ${state.status === "error" ? "text-maroon" : "text-palm"}`}>{state.message}</p>}
      </div>
    </form>
  );
}
