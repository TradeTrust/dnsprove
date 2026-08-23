import type { CustomDnsResolver, IDNSQueryResponse, IDNSRecord } from "../..";

/** Ali DNS JSON API uses numeric RRTYPE; 16 = TXT */
const ALI_DNS_TXT_QUERY_TYPE = "16";
const ALI_DNS_QUERY_TIMEOUT_MS = 10_000;

/**
 * Ali DNS edge caches hold partial snapshots of larger TXT record sets while
 * reporting TC: false, so a single query can silently miss records. The same
 * DoH service is exposed on three hosts (each with its own cache, all with
 * CORS `*`), and the cache is additionally keyed on the edns_client_subnet
 * parameter — so querying several host/ECS combinations and merging the
 * answers recovers the complete record set.
 */
const ALI_DNS_QUERY_VARIANTS: { host: string; ecs?: string }[] = [
  { host: "dns.alidns.com" },
  { host: "223.5.5.5" },
  { host: "223.6.6.6" },
  { host: "223.5.5.5", ecs: "1.2.3.0/24" },
  { host: "223.6.6.6", ecs: "202.96.209.0/24" },
];

const queryAliDnsVariant = async (
  variant: { host: string; ecs?: string },
  domain: string
): Promise<IDNSQueryResponse> => {
  const url = new URL(`https://${variant.host}/resolve`);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", ALI_DNS_TXT_QUERY_TYPE);
  if (variant.ecs) {
    url.searchParams.set("edns_client_subnet", variant.ecs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALI_DNS_QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      throw new Error(`Ali DNS request failed: HTTP ${res.status}`);
    }

    try {
      return (await res.json()) as IDNSQueryResponse;
    } catch {
      throw new Error("Failed to parse DNS response JSON");
    }
  } finally {
    clearTimeout(timer);
  }
};

export const aliDnsResolver: CustomDnsResolver = async (domain) => {
  if (!domain) {
    throw new Error("Domain is required");
  }

  const errors: unknown[] = [];
  const results = await Promise.all(
    ALI_DNS_QUERY_VARIANTS.map(async (variant) => {
      try {
        return await queryAliDnsVariant(variant, domain);
      } catch (error) {
        errors.push(error);
        return undefined;
      }
    })
  );
  const responses = results.filter((result): result is IDNSQueryResponse => result !== undefined);

  if (responses.length === 0) {
    throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  }

  const seen = new Set<string>();
  const mergedAnswers: IDNSRecord[] = [];
  responses.forEach((response) => {
    (response.Answer || []).forEach((record) => {
      const key = `${record.name}|${record.type}|${record.data}`;
      if (!seen.has(key)) {
        seen.add(key);
        mergedAnswers.push(record);
      }
    });
  });

  return {
    ...responses[0],
    AD: responses.every((response) => response.AD),
    Answer: mergedAnswers,
  };
};
