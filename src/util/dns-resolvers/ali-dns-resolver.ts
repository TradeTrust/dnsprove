import type { CustomDnsResolver, IDNSQueryResponse } from "../..";

/** Ali DNS JSON API uses numeric RRTYPE; 16 = TXT */
const ALI_DNS_TXT_QUERY_TYPE = "16";
export const aliDnsResolver: CustomDnsResolver = async (domain) => {
  const url = new URL("https://dns.alidns.com/resolve");

  if (!domain) {
    throw new Error("Domain is required");
  }

  url.searchParams.set("name", domain);
  url.searchParams.set("type", ALI_DNS_TXT_QUERY_TYPE);

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Ali DNS request failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Failed to parse DNS response JSON");
  }

  return data as IDNSQueryResponse;
};
