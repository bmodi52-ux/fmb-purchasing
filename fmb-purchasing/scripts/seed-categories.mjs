// Applies supabase/migrations/0004_categories.sql data via the JS client
// (plain DML, so no SQL Editor round-trip needed). Safe to re-run — skips
// names that already exist.
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

const categories = [
  ["Groceries & Provisions", 10],
  ["Meat & Poultry", 20],
  ["Produce (Fruit & Vegetables)", 30],
  ["Dairy & Eggs", 40],
  ["Bakery", 50],
  ["Beverages", 60],
  ["Disposables & Packaging", 70],
  ["Cleaning & Sanitation", 80],
  ["Kitchen Equipment & Utensils", 90],
  ["Gas & Fuel", 100],
  ["Maintenance & Repairs", 110],
  ["Events & Venue", 120],
  ["Transport & Logistics", 130],
  ["Stationery & Printing", 140],
  ["Professional & Contractor Services", 150],
  ["Miscellaneous", 999],
].map(([name, sort_order]) => ({ name, sort_order }));

const { error } = await admin.from("categories").upsert(categories, { onConflict: "name" });
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Seeded ${categories.length} categories.`);
