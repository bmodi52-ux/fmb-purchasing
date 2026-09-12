import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories, categoryLabelsById, sortCategories } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { CHANNELS, NOTIFICATION_KINDS } from "@/lib/notification-kinds";
import { ALERT_EVENTS } from "@/lib/alert-events";
import { SubmitButton } from "@/components/submit-button";
import { deleteAlertRule, setAlertRuleActive } from "./actions";
import { AlertRuleForm, AnnouncementForm, TeamDefaultSelect } from "./forms";

export const metadata = { title: "Announcements & alerts" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * Notifications, from the admin's side (#28): what each team starts with and
 * cannot turn off, announcements to send, and alert rules to build.
 */
export default async function NotificationsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "announcements", "view");

  const admin = createAdminClient();
  const [
    { data: teams },
    { data: people },
    { data: defaults },
    { data: announcements },
    { data: rules },
    { data: categoryRows },
    { data: vendors },
  ] = await Promise.all([
    admin.from("teams").select("id, name").order("name"),
    admin.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    admin.from("team_notification_defaults").select("team_id, kind, channel, enabled, required"),
    admin.from("announcements").select("id, title, recipient_count, created_by, created_at").order("created_at", { ascending: false }).limit(10),
    admin.from("alert_rules").select("id, name, event, conditions, recipients, active, created_at").order("created_at", { ascending: false }),
    admin.from("categories").select("id, name, parent_category_id"),
    admin.from("vendors").select("id, name").eq("status", "approved").order("name"),
  ]);

  const teamOptions = (teams ?? []).map((t) => ({ id: t.id as string, label: t.name as string }));
  const peopleOptions = (people ?? []).map((p) => ({ id: p.id as string, label: (p.full_name || p.email) as string }));
  const categoryLabels = categoryLabelsById(categoryRows ?? []);
  const categoryOptions = leafCategories(sortCategories(categoryRows ?? [])).map((c) => ({
    id: c.id,
    label: categoryLabels.get(c.id) ?? c.name,
  }));
  const vendorOptions = (vendors ?? []).map((v) => ({ id: v.id as string, label: v.name as string }));

  const teamName = new Map(teamOptions.map((t) => [t.id, t.label]));
  const personName = new Map(peopleOptions.map((p) => [p.id, p.label]));
  const vendorName = new Map(vendorOptions.map((v) => [v.id, v.label]));
  const settingOf = new Map(
    (defaults ?? []).map((d) => [
      `${d.team_id}:${d.kind}:${d.channel}`,
      (d.required ? "required" : d.enabled ? "on" : "off") as "required" | "on" | "off",
    ])
  );

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="page-title text-ink">Announcements &amp; alerts</h1>
        <p className="page-description mt-1 max-w-2xl">
          Send an announcement, build alerts, and choose what each team&apos;s notifications start as — or make them
          required, so members can&apos;t turn them off.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Send an announcement</h2>
        <AnnouncementForm teams={teamOptions} people={peopleOptions} />
        {(announcements ?? []).length > 0 && (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(announcements ?? []).map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between">
                <span className="text-ink">{a.title}</span>
                <span className="text-xs text-ink/50">
                  {a.recipient_count} {a.recipient_count === 1 ? "person" : "people"} ·{" "}
                  {personName.get(a.created_by as string) ?? "—"} · {formatDateTime(a.created_at as string)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Alerts</h2>
        {(rules ?? []).length > 0 && (
          <ul className="flex flex-col divide-y divide-ink/5 rounded-lg border border-ink/10 bg-white/60 text-sm">
            {(rules ?? []).map((r) => {
              const c = (r.conditions ?? {}) as { minAmount?: number; categoryIds?: string[]; vendorIds?: string[]; budgetPercent?: number };
              const rec = (r.recipients ?? {}) as { teamIds?: string[]; userIds?: string[] };
              const parts = [
                ALERT_EVENTS.find((e) => e.event === r.event)?.label ?? r.event,
                c.minAmount != null ? `at least ${money(c.minAmount)}` : null,
                c.budgetPercent != null ? `at ${c.budgetPercent}%` : null,
                c.categoryIds?.length ? `in ${c.categoryIds.map((id) => categoryLabels.get(id) ?? "a removed category").join(", ")}` : null,
                c.vendorIds?.length ? `from ${c.vendorIds.map((id) => vendorName.get(id) ?? "a vendor").join(", ")}` : null,
              ].filter(Boolean);
              const tell = [
                ...(rec.teamIds ?? []).map((id) => teamName.get(id) ?? "a removed team"),
                ...(rec.userIds ?? []).map((id) => personName.get(id) ?? "someone inactive"),
              ];
              return (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className={r.active ? "" : "opacity-50"}>
                    <p className="font-medium text-ink">{r.name}</p>
                    <p className="text-xs text-ink/60">
                      {parts.join(", ")} → tell {tell.join(", ") || "nobody"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <form action={setAlertRuleActive}>
                      <input type="hidden" name="rule_id" value={r.id} />
                      <input type="hidden" name="active" value={String(!r.active)} />
                      <SubmitButton className="text-xs text-ink/60 underline hover:text-ink">{r.active ? "Pause" : "Resume"}</SubmitButton>
                    </form>
                    <form action={deleteAlertRule}>
                      <input type="hidden" name="rule_id" value={r.id} />
                      <SubmitButton className="text-xs text-maroon/70 underline hover:text-maroon">Delete</SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <details className="group" open={(rules ?? []).length === 0}>
          <summary className="cursor-pointer text-sm text-gold-deep underline">+ Build an alert</summary>
          <div className="mt-3">
            <AlertRuleForm teams={teamOptions} people={peopleOptions} categories={categoryOptions} vendors={vendorOptions} />
          </div>
        </details>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="section-title text-ink">What each team starts with</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-ink/55">
            Standard uses the app&apos;s own choice. Starts on or off sets what a member has until they change it.
            Required switches it on and stops members turning it off. Someone in several teams gets a kind if any of
            their teams starts it on, and can&apos;t turn it off if any team requires it.
          </p>
        </div>
        {teamOptions.map((team) => (
          <details key={team.id} className="rounded-lg border border-ink/10 bg-white/60">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-ink">{team.label}</summary>
            <div className="overflow-x-auto border-t border-ink/10">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-ink/55">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Notification</th>
                    {CHANNELS.map((c) => (
                      <th key={c.channel} scope="col" className="px-3 py-2 font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_KINDS.map((k) => (
                    <tr key={k.kind} className="border-t border-ink/5">
                      <th scope="row" className="px-4 py-2 text-left font-normal text-ink">
                        {k.label}
                      </th>
                      {CHANNELS.map(({ channel, label }) => (
                        <td key={channel} className="px-3 py-2">
                          {k.locked?.[channel] ? (
                            <span className="text-xs text-ink/45">Always on</span>
                          ) : (
                            <TeamDefaultSelect
                              teamId={team.id}
                              kind={k.kind}
                              channel={channel}
                              value={settingOf.get(`${team.id}:${k.kind}:${channel}`) ?? "standard"}
                              label={`${team.label}: ${k.label}, ${label}`}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
