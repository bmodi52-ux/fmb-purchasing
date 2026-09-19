import { NAV_ITEMS } from "@/lib/nav";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One record's page, named for what it is rather than the list it's in. */
const RECORD_PAGES: [prefix: string, name: string][] = [
  ["/expenses/", "expense"],
  ["/pricelist/", "item"],
  ["/vendors/", "vendor"],
];

/**
 * What a page is called, for "Loading Submit expense…" (#57): the sidebar's
 * name for it, or for the section it sits in.
 */
export function pageNameFor(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "Home";

  const exact = NAV_ITEMS.find((n) => n.href === path);
  if (exact) return exact.label;

  const segments = path.split("/");
  const last = segments[segments.length - 1] ?? "";
  if (UUID.test(last)) {
    const record = RECORD_PAGES.find(([prefix]) => path.startsWith(prefix));
    if (record) return record[1];
  }

  const section = NAV_ITEMS.filter((n) => path.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return section?.label ?? "this page";
}

/** The path with record ids taken out, so slow loads of every expense group as one. */
export function pathPattern(pathname: string): string {
  return pathname
    .split("/")
    .map((s) => (UUID.test(s) ? "[id]" : s))
    .join("/");
}
