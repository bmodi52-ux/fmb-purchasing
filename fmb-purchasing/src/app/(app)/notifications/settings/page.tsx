import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import {
  CHANNELS,
  NOTIFICATION_KINDS,
  channelState,
  type Audience,
  type TeamSetting,
} from "@/lib/notification-kinds";
import { removePushSubscription, resetNotificationPreferences, setNotificationPreference } from "../actions";
import { PushDevices } from "./push-devices";

export const metadata = { title: "Notification settings" };

/**
 * Which notifications reach a person, and how (#28).
 *
 * Every signed-in person has this page. A kind is only listed if it can reach
 * them at all — nobody without approval rights is offered a switch for
 * "an expense to approve".
 */
export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const permissions = await getUserPermissions(user);
  const inAudience = (audience: Audience[]) =>
    audience.some(
      (a) =>
        a === "everyone" ||
        (a === "approvers" && can(permissions, "approvals", "approve")) ||
        (a === "payers" && can(permissions, "payments", "mark_paid")) ||
        (a === "admins" && can(permissions, "admin_users", "manage_users"))
    );
  const kinds = NOTIFICATION_KINDS.filter((k) => inAudience(k.audience));

  const admin = createAdminClient();
  const [{ data: prefs }, { data: defaults }, { data: devices }] = await Promise.all([
    admin.from("notification_preferences").select("kind, channel, enabled").eq("user_id", user.id),
    user.teamIds.length
      ? admin.from("team_notification_defaults").select("kind, channel, enabled, required").in("team_id", user.teamIds)
      : Promise.resolve({ data: [] }),
    admin.from("push_subscriptions").select("id, device_label, created_at, last_sent_at").eq("user_id", user.id).order("created_at"),
  ]);

  const own = new Map((prefs ?? []).map((p) => [`${p.kind}:${p.channel}`, p.enabled as boolean]));
  const teamSettings = (kind: string, channel: string): TeamSetting[] =>
    (defaults ?? [])
      .filter((d) => d.kind === kind && d.channel === channel)
      .map((d) => ({ enabled: d.enabled as boolean, required: d.required as boolean }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/notifications" className="text-sm text-ink/50 hover:text-ink">
          ← Notifications
        </Link>
        <h1 className="page-title mt-1 text-ink">Notification settings</h1>
        <p className="page-description mt-1 max-w-xl">
          Choose how each kind of notification reaches you. Anything switched off still happened — it just won&apos;t
          interrupt you.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Push on this device</h2>
        <div className="rounded-lg border border-ink/10 bg-white/60 p-4">
          <PushDevices publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
          {(devices ?? []).length > 0 && (
            <ul className="mt-4 flex flex-col divide-y divide-ink/5 border-t border-ink/10 pt-2 text-sm">
              {(devices ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {d.device_label ?? "A device"}
                    <span className="block text-xs text-ink/45">
                      Added {formatDateTime(d.created_at as string)}
                      {d.last_sent_at ? ` · last sent ${formatDateTime(d.last_sent_at as string)}` : ""}
                    </span>
                  </span>
                  <form action={removePushSubscription}>
                    <input type="hidden" name="subscription_id" value={d.id} />
                    <SubmitButton className="text-xs text-maroon/70 hover:text-maroon">Remove</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-title text-ink">What reaches you</h2>
          {(prefs ?? []).length > 0 && (
            <form action={resetNotificationPreferences}>
              <SubmitButton className="text-xs text-ink/55 underline hover:text-ink">Go back to my team&apos;s settings</SubmitButton>
            </form>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
          <table className="min-w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs text-ink/55">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Notification</th>
                {CHANNELS.map((c) => (
                  <th key={c.channel} scope="col" className="px-3 py-2.5 text-center font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.kind} className="border-b border-ink/5 last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <span className="text-ink">{k.label}</span>
                    <span className="block text-xs text-ink/50">{k.description}</span>
                  </th>
                  {CHANNELS.map(({ channel, label }) => {
                    const state = channelState(k.kind, channel, own.get(`${k.kind}:${channel}`), teamSettings(k.kind, channel));
                    return (
                      <td key={channel} className="px-3 py-2.5 text-center">
                        {state.lockedBy ? (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded border border-palm/40 bg-palm/60 text-xs text-white"
                            title={state.lockedBy === "team" ? "Required by your team" : "Always on"}
                            aria-label={`${label}: on, ${state.lockedBy === "team" ? "required by your team" : "always on"}`}
                          >
                            ✓
                          </span>
                        ) : (
                          <form action={setNotificationPreference}>
                            <input type="hidden" name="kind" value={k.kind} />
                            <input type="hidden" name="channel" value={channel} />
                            <input type="hidden" name="enabled" value={String(!state.enabled)} />
                            <SubmitButton
                              aria-label={`${label} for ${k.label}: ${state.enabled ? "on — turn off" : "off — turn on"}`}
                              className={`h-6 w-6 rounded border text-xs ${
                                state.enabled ? "border-palm bg-palm/80 text-white" : "border-ink/20 bg-white"
                              }`}
                            >
                              {state.enabled ? "✓" : ""}
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink/50">
          A dimmed tick is required by your team or always on, and can&apos;t be switched off here. Email goes to {user.email}.
        </p>
      </section>
    </div>
  );
}
