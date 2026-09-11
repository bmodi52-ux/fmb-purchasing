import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Organisation-wide settings an admin can change (migration 0046).
 *
 * Every key has a default here, so a setting works before anyone has saved
 * it, and a value that fails to parse falls back rather than breaking a page.
 */

export const SETTING_DEFAULTS = {
  /** Show "Possible duplicate" on Approvals and Payments (scratchpad #21). */
  duplicate_flags_for_reviewers: true as boolean,
  /**
   * A line in an equipment category at or above this amount, GST included, is
   * suggested as a capital purchase (0048, #50).
   */
  capital_purchase_threshold: 1000 as number,
  /** Daily reminders and escalation (#27). Days are whole days waiting. */
  reminders: {
    enabled: true,
    approvals: { firstAfterDays: 2, escalateAfterDays: 5, escalateTeamId: null as string | null },
    payments: { firstAfterDays: 3, escalateAfterDays: 7, escalateTeamId: null as string | null },
    bankAccounts: { firstAfterDays: 1, escalateAfterDays: 3, escalateTeamId: null as string | null },
    declinedAfterDays: 3,
    /** 0 is Sunday; 1 is Monday. */
    masterDataWeekday: 1,
  },
};

export type ReminderSettings = (typeof SETTING_DEFAULTS)["reminders"];

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

/**
 * A stored value, checked against the shape of its default. Objects are merged
 * over the default, so a setting that gains a field later still reads an old
 * row correctly.
 */
function coerce<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const fallback: unknown = SETTING_DEFAULTS[key];
  let value: unknown = fallback;
  if (raw !== null && raw !== undefined) {
    if (typeof fallback === "number") value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
    else if (typeof fallback === "object" && fallback !== null && !Array.isArray(fallback)) {
      value = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...fallback, ...raw } : fallback;
    } else value = typeof raw === typeof fallback ? raw : fallback;
  }
  return value as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(admin: SupabaseClient, key: K): Promise<SettingValue<K>> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return coerce(key, data?.value);
}

export async function getSettings<K extends SettingKey>(
  admin: SupabaseClient,
  keys: K[]
): Promise<{ [P in K]: SettingValue<P> }> {
  const { data } = await admin.from("app_settings").select("key, value").in("key", keys);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value]));
  return Object.fromEntries(keys.map((k) => [k, coerce(k, byKey.get(k))])) as { [P in K]: SettingValue<P> };
}

export async function setSetting<K extends SettingKey>(
  admin: SupabaseClient,
  key: K,
  value: SettingValue<K>,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await admin
    .from("app_settings")
    .upsert({ key, value, updated_by: userId, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}

export { coerce as coerceSetting };
