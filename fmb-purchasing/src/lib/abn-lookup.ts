/**
 * ABN Lookup — free ABR web service (kept from the prior prototype, §3).
 * Requires a personal GUID from abr.business.gov.au/Tools/WebServices,
 * set as ABN_LOOKUP_GUID. Called server-side now (the prototype exposed it
 * via a client-side JSONP hack).
 */
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

export async function lookupAbn(abn: string): Promise<AbnLookupResult> {
  const digits = abn.replace(/\D/g, "");
  if (digits.length !== 11) return { error: "ABN must be 11 digits." };

  const guid = requireGuid();
  if (typeof guid !== "string") return guid;

  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${digits}&guid=${encodeURIComponent(guid)}`;
  const res = await fetch(url);
  if (!res.ok) return { error: "Could not reach the ABN Lookup service." };

  const data = await res.json();
  if (data.Message) return { error: data.Message };

  const name = data.EntityName || data.BusinessName?.[0];
  if (!name) return { error: "No registered name found for this ABN." };

  return {
    name,
    state: data.AddressState || null,
    postcode: data.AddressPostcode || null,
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

    const data = await res.json();
    const names = Array.isArray(data?.Names) ? data.Names : [];

    return names
      .filter((n: Record<string, unknown>) => n?.Abn && n?.Name)
      .map((n: Record<string, unknown>) => ({
        name: String(n.Name),
        abn: String(n.Abn),
        state: (n.State as string) || null,
        postcode: (n.Postcode as string) || null,
      }));
  } catch {
    return [];
  }
}
