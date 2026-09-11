"use client";

import { useActionState, useState } from "react";
import { ALERT_EVENTS, type AlertEvent } from "@/lib/alert-events";
import { CALENDAR_LABELS, type CalendarKind } from "@/lib/periods";
import {
  saveAlertRule,
  sendAnnouncement,
  setTeamNotificationDefault,
  type AlertRuleState,
  type AnnouncementState,
} from "./actions";

type Option = { id: string; label: string };

/** A team's setting for one kind on one channel, saved as soon as it changes. */
export function TeamDefaultSelect({
  teamId,
  kind,
  channel,
  value,
  label,
}: {
  teamId: string;
  kind: string;
  channel: string;
  value: "standard" | "on" | "off" | "required";
  label: string;
}) {
  return (
    <form action={setTeamNotificationDefault}>
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="channel" value={channel} />
      <select
        name="value"
        defaultValue={value}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`rounded border px-1.5 py-1 text-xs ${
          value === "required" ? "border-palm/50 text-palm" : value === "standard" ? "border-ink/15 text-ink/50" : "border-ink/25 text-ink"
        }`}
      >
        <option value="standard">Standard</option>
        <option value="on">Starts on</option>
        <option value="off">Starts off</option>
        <option value="required">Required</option>
      </select>
    </form>
  );
}

function CheckList({ name, options, label }: { name: string; options: Option[]; label: string }) {
  const [query, setQuery] = useState("");
  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  return (
    <fieldset className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-xs">
      <legend className="mb-1 text-ink/55">{label}</legend>
      {options.length > 8 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="input py-1 text-xs"
        />
      )}
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-ink/10 bg-white p-2">
        {options.map((o) => (
          <label key={o.id} className={`flex items-center gap-2 ${shown.includes(o) ? "" : "hidden"}`}>
            <input type="checkbox" name={name} value={o.id} />
            {o.label}
          </label>
        ))}
        {options.length === 0 && <span className="text-ink/40">None yet</span>}
      </div>
    </fieldset>
  );
}

export function AnnouncementForm({ teams, people }: { teams: Option[]; people: Option[] }) {
  const [state, action, pending] = useActionState<AnnouncementState, FormData>(sendAnnouncement, { status: "idle" });
  const [audience, setAudience] = useState<"everyone" | "chosen">("everyone");

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Title</span>
        <input name="title" required placeholder="Ashara purchasing closes Friday" className="input text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Message (optional)</span>
        <textarea name="body" rows={3} className="input text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Link to a page in the app (optional)</span>
        <input name="link" placeholder="/submit" className="input text-sm" />
      </label>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-xs text-ink/55">Send to</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" value="everyone" checked={audience === "everyone"} onChange={() => setAudience("everyone")} />
          Everyone
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="audience" value="chosen" checked={audience === "chosen"} onChange={() => setAudience("chosen")} />
          Chosen teams and people
        </label>
      </fieldset>
      {audience === "chosen" && (
        <div className="flex flex-wrap gap-3">
          <CheckList name="team_ids" options={teams} label="Teams" />
          <CheckList name="user_ids" options={people} label="People" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep disabled:opacity-60">
          {pending ? "Sending…" : "Send announcement"}
        </button>
        {state.message && (
          <p className={`text-xs ${state.status === "error" ? "text-maroon" : "text-palm"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}

export function AlertRuleForm({
  teams,
  people,
  categories,
  vendors,
}: {
  teams: Option[];
  people: Option[];
  categories: Option[];
  vendors: Option[];
}) {
  const [state, action, pending] = useActionState<AlertRuleState, FormData>(saveAlertRule, { status: "idle" });
  const [event, setEvent] = useState<AlertEvent>("expense_submitted");
  const expenseEvent = event === "expense_submitted" || event === "expense_approved" || event === "expense_paid";

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Name</span>
        <input name="name" required placeholder="Large event spend" className="input text-sm" />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">When</span>
        <select name="event" value={event} onChange={(e) => setEvent(e.target.value as AlertEvent)} className="input text-sm">
          {ALERT_EVENTS.map((e) => (
            <option key={e.event} value={e.event}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink/55">Only if</p>
        {expenseEvent && (
          <label className="flex items-center gap-2 text-sm">
            the amount is at least $
            <input name="min_amount" inputMode="decimal" placeholder="1000" className="input w-28 py-1" />
          </label>
        )}
        {event === "budget_threshold" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            spending reaches
            <input name="budget_percent" inputMode="decimal" placeholder="80" className="input w-20 py-1" />% of the budget for the
            <select name="calendar" defaultValue="hijri" className="input py-1 text-sm">
              {(Object.keys(CALENDAR_LABELS) as CalendarKind[]).map((k) => (
                <option key={k} value={k}>
                  {CALENDAR_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {event !== "vendor_added" && <CheckList name="category_ids" options={categories} label="In these categories (any)" />}
          {event !== "budget_threshold" && <CheckList name="vendor_ids" options={vendors} label="From these vendors (any)" />}
        </div>
        <p className="text-xs text-ink/45">Leave a list empty to match anything.</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink/55">Tell</p>
        <div className="flex flex-wrap gap-3">
          <CheckList name="team_ids" options={teams} label="Teams" />
          <CheckList name="user_ids" options={people} label="People" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep disabled:opacity-60">
          {pending ? "Saving…" : "Save alert"}
        </button>
        {state.message && (
          <p className={`text-xs ${state.status === "error" ? "text-maroon" : "text-palm"}`}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
