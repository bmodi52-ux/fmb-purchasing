/**
 * ABN Lookup — free ABR web service (kept from the prior prototype, §3).
 * Requires a personal GUID from abr.business.gov.au/Tools/WebServices,
 * set as ABN_LOOKUP_GUID. Called server-side now (the prototype exposed it
 * via a client-side JSONP hack).
 */
import { reportError } from "@/lib/errors";

export type AbnLookupResult =
  | { name: string; state: string | null; postcode: string | null }
  | { error: string };

export type AbnNameMatch = {
  name: string;
  abn: string;
  state: string | null;
  postcode: string | null;
};

function requireGuid(): string | { error: string } {
  const guid = process.env.ABN_LOOKUP_GUID;
  if (!guid) return { error: "ABN Lookup isn't configured yet (missing ABN_LOOKUP_GUID)." };
  return guid;
}

/**
 * The ABR's `/json/*.aspx` endpoints are a JSONP API wearing a JSON path.
 * Depending on the endpoint and whether a `callback` is supplied, the body
 * comes back either as bare JSON or wrapped in `callback({...})` — and
 * `response.json()` throws on the wrapped form.
 *
 * That mattered more than it looks. The name search caught its own failure and
 * returned an empty array, so a parse error was indistinguishable from "no
 * business by that name" — the lookup could have been broken since it was
 * written and the only symptom would be that it never found anything.
 *
 * Read as text and unwrap if wrapped, so both shapes work and a genuine parse
 * failure is reported instead of being mistaken for an empty result.
 */
function parseAbrBody(body: string): unknown {
  const trimmed = body.trim();
  // callback({...}) or callback([...]);  — take what is inside the outermost
  // parentheses, which is the JSON payload.
  const wrapped = /^[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed);
  return JSON.parse(wrapped ? wrapped[1]! : trimmed);
}

export async function lookupAbn(abn: string): Promise<AbnLookupResult> {
  const digits = abn.replace(/\D/g, "");
  if (digits.length !== 11) return { error: "ABN must be 11 digits." };

  const guid = requireGuid();
  if (typeof guid !== "string") return guid;

  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${digits}&guid=${encodeURIComponent(guid)}`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: "Could not reach the ABN Lookup service." };
    data = parseAbrBody(await res.text()) as Record<string, unknown>;
  } catch (err) {
    await reportError({ source: "abn-lookup", error: err, detail: `ABN ${digits}` });
    return { error: "The ABN Lookup service returned something unreadable." };
  }

  if (data.Message) return { error: String(data.Message) };

  const businessNames = data.BusinessName as string[] | undefined;
  const name = (data.EntityName as string) || businessNames?.[0];
  if (!name) return { error: "No registered name found for this ABN." };

  return {
    name,
    state: (data.AddressState as string) || null,
    postcode: (data.AddressPostcode as string) || null,
  };
}

/** Search the ABR by business name — used to suggest matches as the user types. */
export async function searchAbnByName(name: string): Promise<AbnNameMatch[]> {
  const query = name.trim();
  if (query.length < 3) return [];

  const guid = requireGuid();
  if (typeof guid !== "string") return [];

  try {
    const url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(query)}&maxResults=8&guid=${encodeURIComponent(guid)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = parseAbrBody(await res.text()) as { Names?: Record<string, unknown>[] };
    const names = Array.isArray(data?.Names) ? data.Names : [];

    return names
      .filter((n) => n?.Abn && n?.Name)
      .map((n) => ({
        name: String(n.Name),
        abn: String(n.Abn),
        state: (n.State as string) || null,
        postcode: (n.Postcode as string) || null,
      }));
  } catch (err) {
    // Still returns [] to the caller — a vendor suggestion list that cannot
    // reach the ABR should degrade to local matches, not fail the form. But it
    // no longer does so silently.
    await reportError({ source: "abn-lookup-search", error: err, detail: `name "${query}"` });
    return [];
  }
}
