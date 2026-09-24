import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Reading a shop's product page from a pasted link (#29).
 *
 * The page is turned into a short text the product reader can work from,
 * best evidence first: the structured product record most shops publish
 * (schema.org Product — name, brand, price, barcode), then the page's own
 * description tags, then the lines of visible text that mention a price.
 * Woolworths and Coles publish the record with the price; Costco publishes it
 * without one, and the price is in the visible text.
 *
 * Fetching someone else's page from our server is also a way to make our
 * server fetch things it shouldn't, so only public http(s) addresses are
 * read — every hop of a redirect is checked again — with a timeout and a cap
 * on how much is read.
 */

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const MAX_TEXT = 14_000;

/** A link that couldn't be read, said in words for the person who pasted it. */
export class LinkUnreadable extends Error {}

/** Shops whose name isn't simply their domain's first word. */
const KNOWN_SHOPS: Record<string, string> = {
  "woolworths.com.au": "Woolworths",
  "coles.com.au": "Coles",
  "costco.com.au": "Costco",
  "aldi.com.au": "Aldi",
  "iga.com.au": "IGA",
  "harrisfarm.com.au": "Harris Farm",
  "bunnings.com.au": "Bunnings",
  "officeworks.com.au": "Officeworks",
  "amazon.com.au": "Amazon",
};

/** The shop's domain without "www." — how a vendor is found by its website. */
export function shopDomain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export function shopName(domain: string, siteName: string | null): string {
  const known = Object.entries(KNOWN_SHOPS).find(([d]) => domain === d || domain.endsWith(`.${d}`));
  if (known) return known[1];
  if (siteName) return siteName;
  const first = domain.split(".")[0] ?? domain;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Addresses that are not the public internet: this machine, the local network, the cloud's own metadata. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("ff");
}

/** Whether a pasted string is a link worth trying, before anything is fetched. */
export function parseLink(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LinkUnreadable("That doesn't look like a web address. Copy the whole link from the shop's page.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LinkUnreadable("Only web page links (https://…) can be read.");
  }
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
    throw new LinkUnreadable("That link can't be read.");
  }
  return url;
}

async function assertPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new LinkUnreadable("That website couldn't be found. Check the link.");
  if (addresses.some(isPrivateAddress)) throw new LinkUnreadable("That link can't be read.");
}

/** Fetches the page, following redirects one checked hop at a time. */
async function fetchPage(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-AU,en;q=0.9",
        },
      });
    } catch {
      throw new LinkUnreadable("The shop's page didn't answer in time.");
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) break;
      url = parseLink(new URL(next, url).toString());
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new LinkUnreadable("The shop's website wouldn't let the app read that page.");
    }
    if (!response.ok) throw new LinkUnreadable(`The shop's website answered with an error (${response.status}).`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) throw new LinkUnreadable("That link isn't a web page.");
    return { html: await readCapped(response), finalUrl: url };
  }
  throw new LinkUnreadable("That link redirects too many times.");
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).trim() || null : null;
}

/** Every schema.org Product in the page's structured data. */
export function productRecords(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const type = n["@type"];
    const types = (Array.isArray(type) ? type : [type]).map((t) => String(t).toLowerCase());
    if (types.includes("product")) found.push(n);
    else Object.values(n).forEach(visit);
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]));
    } catch {
      // A malformed block is skipped; the rest of the page still reads.
    }
  }
  return found;
}

/** The page as text, script and markup removed. */
export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

/** Lines of text that mention a price or a special, with a little around each. */
function priceLines(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (/\$\s?\d|\bwas\b|\bsave\b|special|per (kg|100g|l|litre|each)|gst/i.test(l)) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) keep.add(j);
    }
  });
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => lines[i])
    .join("\n");
}

/**
 * A product record cut down to what says what it is and what it costs.
 * Pages pad theirs with reviews, ratings and whole nutrition panels, which
 * would crowd the price out of what the reader is given.
 */
export function slimRecord(record: Record<string, unknown>): Record<string, unknown> {
  const brand = record.brand as { name?: unknown } | string | undefined;
  const offers = (Array.isArray(record.offers) ? record.offers : record.offers ? [record.offers] : []) as Record<
    string,
    unknown
  >[];
  const description = typeof record.description === "string" ? visibleText(record.description).slice(0, 300) : undefined;
  return {
    name: record.name,
    brand: typeof brand === "string" ? brand : brand?.name,
    sku: record.sku,
    gtin: record.gtin ?? record.gtin13 ?? record.gtin14,
    size: record.size ?? record.weight,
    description,
    offers: offers.map((o) => ({
      price: o.price ?? o.lowPrice,
      priceCurrency: o.priceCurrency,
      priceValidUntil: o.priceValidUntil,
      priceSpecification: o.priceSpecification,
      availability: o.availability,
    })),
  };
}

/** What the product reader is given for a page: best evidence first, capped. */
export function pageToProductText(html: string, url: string): { text: string; siteName: string | null } {
  const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const siteName = meta(html, "og:site_name");
  const records = productRecords(html);
  const parts = [
    `Web page: ${url}`,
    title && `Title: ${title}`,
    meta(html, "og:title") && `Page title: ${meta(html, "og:title")}`,
    meta(html, "og:description") && `Description: ${meta(html, "og:description")}`,
    meta(html, "product:price:amount") && `Price tag: ${meta(html, "product:price:amount")}`,
    records.length > 0 && `Structured product data:\n${JSON.stringify(records.slice(0, 20).map(slimRecord)).slice(0, 6000)}`,
    `Text on the page that mentions a price:\n${priceLines(visibleText(html))}`,
  ].filter(Boolean) as string[];
  return { text: parts.join("\n\n").slice(0, MAX_TEXT), siteName };
}

export type ProductLinkPage = {
  url: string;
  domain: string;
  store: string;
  text: string;
};

export async function readProductLink(input: string): Promise<ProductLinkPage> {
  const { html, finalUrl } = await fetchPage(parseLink(input));
  const { text, siteName } = pageToProductText(html, finalUrl.toString());
  if (!/\$\s?\d|"price"/i.test(text)) {
    throw new LinkUnreadable("No price could be found on that page. The shop may only show it after the page loads.");
  }
  const domain = shopDomain(finalUrl.toString());
  return { url: finalUrl.toString(), domain, store: shopName(domain, siteName), text };
}
