import type { CustomDnsResolver, IDNSQueryResponse } from "../..";

export const googleDnsResolver: CustomDnsResolver = async (domain) => {
  const url = new URL("https://dns.google/resolve");

  if (!domain) {
    throw new Error("Domain is required");
  }

  url.searchParams.set("name", domain);
  url.searchParams.set("type", "TXT");

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Google DNS request failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Failed to parse DNS response JSON");
  }

  return data as IDNSQueryResponse;
};
