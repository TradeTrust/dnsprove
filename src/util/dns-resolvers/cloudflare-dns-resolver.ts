import type { CustomDnsResolver, IDNSQueryResponse } from "../..";

export const cloudflareDnsResolver: CustomDnsResolver = async (domain) => {
  const url = new URL("https://cloudflare-dns.com/dns-query");

  if (!domain) {
    throw new Error("Domain is required");
  }

  url.searchParams.set("name", domain);
  url.searchParams.set("type", "TXT");

  const res = await fetch(url, {
    headers: { Accept: "application/dns-json" },
  });

  if (!res.ok) {
    throw new Error(`Cloudflare DNS request failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Failed to parse DNS response JSON");
  }

  return data as IDNSQueryResponse;
};
