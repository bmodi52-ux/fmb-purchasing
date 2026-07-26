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

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: existing } = await admin.storage.getBucket("receipts");
if (existing) {
  console.log("Bucket 'receipts' already exists.");
} else {
  const { error } = await admin.storage.createBucket("receipts", {
    public: false,
    fileSizeLimit: "15MB",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  });
  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }
  console.log("Created private bucket 'receipts'.");
}
