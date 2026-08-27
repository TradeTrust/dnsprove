import type { CustomDnsResolver, IDNSQueryResponse, IDNSRecord } from "../..";
import { getLogger } from "../logger";

const { trace, error: logError } = getLogger("ali-dns-resolver");

/** Ali DNS JSON API uses numeric RRTYPE; 16 = TXT */
const ALI_DNS_TXT_QUERY_TYPE = "16";
const ALI_DNS_QUERY_TIMEOUT_MS = 10_000;

/**
 * Ali DNS caps every response at roughly 12-14 TXT records regardless of the
 * advertised EDNS buffer size, while reporting TC: false — so a single query
 * silently misses records on larger record sets. The same DoH service is
 * exposed on three hosts (each with its own cache, all with CORS `*`), and
 * the cache is additionally keyed on the edns_client_subnet (ECS) parameter,
 * so each host/ECS combination yields a different partial window onto the
 * record set. The resolver queries in waves of three (one per host, all
 * sharing that wave's ECS value) and merges the deduplicated answers,
 * stopping once the merged set stops growing.
 */
const ALI_DNS_HOSTS = ["dns.alidns.com", "223.5.5.5", "223.6.6.6"];
const ALI_DNS_ECS_WAVES: (string | undefined)[] = [
  undefined,
  "1.2.3.0/24",
  "8.8.8.0/24",
  "114.114.114.0/24",
  "202.96.209.0/24",
  "77.88.8.0/24",
];
/** Stop early once this many consecutive successful waves add no new records */
const ALI_DNS_CONVERGED_WAVES = 2;

const queryAliDnsVariant = async (
  host: string,
  ecs: string | undefined,
  domain: string
): Promise<IDNSQueryResponse> => {
  const url = new URL(`https://${host}/resolve`);
  url.searchParams.set("name", domain);
  url.searchParams.set("type", ALI_DNS_TXT_QUERY_TYPE);
  if (ecs) {
    url.searchParams.set("edns_client_subnet", ecs);
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

  const seen = new Set<string>();
  const mergedAnswers: IDNSRecord[] = [];
  const responses: IDNSQueryResponse[] = [];
  const errors: unknown[] = [];
  let stagnantWaves = 0;

  let waveIndex = 0;
  while (waveIndex < ALI_DNS_ECS_WAVES.length && stagnantWaves < ALI_DNS_CONVERGED_WAVES) {
    const ecs = ALI_DNS_ECS_WAVES[waveIndex];
    waveIndex += 1;
    // eslint-disable-next-line no-await-in-loop
    const waveResults = await Promise.all(
      ALI_DNS_HOSTS.map(async (host) => {
        try {
          return await queryAliDnsVariant(host, ecs, domain);
        } catch (err) {
          logError(`query failed for host=${host} ecs=${ecs}: ${err}`);
          errors.push(err);
          return undefined;
        }
      })
    );
    const waveResponses = waveResults.filter((result): result is IDNSQueryResponse => result !== undefined);
    // A fully failed wave says nothing about coverage, so it must not count towards convergence
    if (waveResponses.length > 0) {
      responses.push(...waveResponses);

      let grew = false;
      waveResponses.forEach((response) => {
        (response.Answer || []).forEach((record) => {
          const key = `${record.name}|${record.type}|${record.data}`;
          if (!seen.has(key)) {
            seen.add(key);
            mergedAnswers.push(record);
            grew = true;
          }
        });
      });

      stagnantWaves = grew ? 0 : stagnantWaves + 1;
      trace(`wave ecs=${ecs}: merged=${mergedAnswers.length} stagnantWaves=${stagnantWaves}`);
    }
  }

  if (responses.length === 0) {
    throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
  }

  return {
    ...responses[0],
    AD: responses.every((response) => response.AD),
    Answer: mergedAnswers,
  };
};
