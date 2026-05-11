import type { CustomDnsResolver, IDNSQueryResponse } from "../..";

/** Server-side DoH proxy that forwards to Google/Cloudflare upstream — reachable from regions where direct access to those endpoints is blocked. */
export const proxyDnsResolver: CustomDnsResolver = async (domain) => {
  const url = new URL("https://dns.opencerts.io/resolve");

  if (!domain) {
    throw new Error("Domain is required");
  }

  url.searchParams.set("name", domain);
  url.searchParams.set("type", "TXT");

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Proxy DNS request failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Failed to parse DNS response JSON");
  }

  return data as IDNSQueryResponse;
};
