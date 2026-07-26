// One-off utility: create the first (admin) account. The very first account
// ever created is auto-enrolled in the full-access "Admin" team by the
// handle_new_user() DB trigger (see supabase/migrations/0003), so this is
// the standard way to bootstrap access to the Teams/Users admin pages.
//
// Usage: node scripts/bootstrap-admin.mjs <username> <password> <full name> <contact email>

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2];
  }
}
loadEnvLocal();

const [username, password, fullName, contactEmail] = process.argv.slice(2);
if (!username || !password || !fullName || !contactEmail) {
  console.error("Usage: node scripts/bootstrap-admin.mjs <username> <password> <full name> <contact email>");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const normalizedUsername = username.trim().toLowerCase();
const authEmail = `${normalizedUsername}@login.fmbpurchasing.internal`;

const { data, error } = await admin.auth.admin.createUser({
  email: authEmail,
  password,
  email_confirm: true,
  user_metadata: { username: normalizedUsername, full_name: fullName, contact_email: contactEmail },
});

if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}

console.log(`Created user ${normalizedUsername} (${data.user.id}).`);
