import { setupServer, SetupServerApi } from "msw/node";
import { http, HttpResponse } from "msw";
import { aliDnsResolver } from "./ali-dns-resolver";
import { cloudflareDnsResolver } from "./cloudflare-dns-resolver";
import { googleDnsResolver } from "./google-dns-resolver";
import { proxyDnsResolver } from "./proxy-dns-resolver";

const emptyDnsJson = {
  Status: 0,
  TC: false,
  RD: true,
  RA: true,
  AD: false,
  CD: false,
  Answer: [] as [],
};

describe("googleDnsResolver", () => {
  let server: SetupServerApi | undefined;

  afterEach(() => {
    server?.close();
  });

  test("requests Google DNS JSON with name, TXT type, and encoded query", async () => {
    server = setupServer(
      http.get("https://dns.google/resolve", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("name")).toBe("my domain.test");
        expect(url.searchParams.get("type")).toBe("TXT");
        return HttpResponse.json(emptyDnsJson);
      })
    );
    server.listen();

    const out = await googleDnsResolver("my domain.test");
    expect(out).toMatchObject({ Status: 0, Answer: [] });
  });

  test("throws when Google DNS returns non-2xx", async () => {
    server = setupServer(http.get("https://dns.google/resolve", () => new HttpResponse(null, { status: 503 })));
    server.listen();

    await expect(googleDnsResolver("my.domain.test")).rejects.toThrow(/HTTP 503/);
  });

  test("throws when domain is empty", async () => {
    await expect(googleDnsResolver("")).rejects.toThrow("Domain is required");
  });
});

describe("cloudflareDnsResolver", () => {
  let server: SetupServerApi | undefined;

  afterEach(() => {
    server?.close();
  });

  test("requests Cloudflare DNS JSON with name, TXT type, Accept header, and encoded query", async () => {
    server = setupServer(
      http.get("https://cloudflare-dns.com/dns-query", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("name")).toBe("cf example.test");
        expect(url.searchParams.get("type")).toBe("TXT");
        expect(request.headers.get("accept")).toBe("application/dns-json");
        return HttpResponse.json(emptyDnsJson);
      })
    );
    server.listen();

    const out = await cloudflareDnsResolver("cf example.test");
    expect(out).toMatchObject({ Status: 0, Answer: [] });
  });

  test("throws when Cloudflare DNS returns non-2xx", async () => {
    server = setupServer(
      http.get("https://cloudflare-dns.com/dns-query", () => new HttpResponse(null, { status: 502 }))
    );
    server.listen();

    await expect(cloudflareDnsResolver("cf.example.test")).rejects.toThrow(/HTTP 502/);
  });

  test("throws when domain is empty", async () => {
    await expect(cloudflareDnsResolver("")).rejects.toThrow("Domain is required");
  });
});

describe("aliDnsResolver", () => {
  let server: SetupServerApi | undefined;

  afterEach(() => {
    server?.close();
  });

  const answer = (data: string) => ({ name: "ali.example.test.", type: 16, TTL: 300, data });
  const ALI_HOSTS = ["dns.alidns.com", "223.5.5.5", "223.6.6.6"];

  test("queries all Ali DNS hosts with name and type 16 (TXT), uses ECS cache-busting, and merges deduplicated answers", async () => {
    const requestedHosts = new Set<string>();
    let ecsRequests = 0;
    const recordsByHost: { [host: string]: ReturnType<typeof answer>[] } = {
      "dns.alidns.com": [answer("record-a")],
      "223.5.5.5": [answer("record-a"), answer("record-b")],
      "223.6.6.6": [answer("record-c")],
    };

    server = setupServer(
      ...ALI_HOSTS.map((host) =>
        http.get(`https://${host}/resolve`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("name")).toBe("ali.example.test");
          expect(url.searchParams.get("type")).toBe("16");
          requestedHosts.add(url.host);
          if (url.searchParams.has("edns_client_subnet")) ecsRequests += 1;
          return HttpResponse.json({ ...emptyDnsJson, Answer: recordsByHost[host] });
        })
      )
    );
    server.listen();

    const out = await aliDnsResolver("ali.example.test");
    const merged = out.Answer.map((r) => r.data).sort();
    expect(merged).toEqual(["record-a", "record-b", "record-c"]);
    expect(Array.from(requestedHosts).sort()).toEqual(ALI_HOSTS.slice().sort());
    expect(ecsRequests).toBeGreaterThan(0);
  });

  test("stops querying once the merged answer set converges", async () => {
    let requestCount = 0;
    server = setupServer(
      ...ALI_HOSTS.map((host) =>
        http.get(`https://${host}/resolve`, () => {
          requestCount += 1;
          return HttpResponse.json({ ...emptyDnsJson, Answer: [answer("record-a")] });
        })
      )
    );
    server.listen();

    await aliDnsResolver("ali.example.test");
    // 6 ECS waves x 3 hosts = 18 possible requests; convergence must stop it well short of that
    expect(requestCount).toBeLessThan(18);
  });

  test("returns merged answers from remaining endpoints when some endpoints fail", async () => {
    server = setupServer(
      http.get("https://dns.alidns.com/resolve", () => new HttpResponse(null, { status: 503 })),
      http.get("https://223.5.5.5/resolve", () => new HttpResponse(null, { status: 503 })),
      http.get("https://223.6.6.6/resolve", () => HttpResponse.json({ ...emptyDnsJson, Answer: [answer("record-a")] }))
    );
    server.listen();

    const out = await aliDnsResolver("ali.example.test");
    expect(out.Answer.map((r) => r.data)).toEqual(["record-a"]);
  });

  test("does not count consecutive fully failed waves towards convergence", async () => {
    // Fail each host's first two requests — i.e. the first two whole waves — regardless
    // of which ECS values the strategy uses. Without the failed-wave guard, two failed
    // waves reach the convergence threshold and the resolver aborts before ever seeing
    // an answer; with the guard it keeps going and succeeds on the third wave.
    const failuresPerHost: { [host: string]: number } = {};
    server = setupServer(
      ...ALI_HOSTS.map((host) =>
        http.get(`https://${host}/resolve`, () => {
          failuresPerHost[host] = (failuresPerHost[host] || 0) + 1;
          if (failuresPerHost[host] <= 2) return new HttpResponse(null, { status: 503 });
          return HttpResponse.json({ ...emptyDnsJson, Answer: [answer("record-a")] });
        })
      )
    );
    server.listen();

    const out = await aliDnsResolver("ali.example.test");
    expect(out.Answer.map((r) => r.data)).toEqual(["record-a"]);
  });

  test("does not count fully failed waves towards convergence", async () => {
    // The first wave carries no edns_client_subnet parameter and fails entirely;
    // later ECS waves succeed, so the resolver must still return their records.
    server = setupServer(
      ...ALI_HOSTS.map((host) =>
        http.get(`https://${host}/resolve`, ({ request }) => {
          const url = new URL(request.url);
          if (!url.searchParams.has("edns_client_subnet")) return new HttpResponse(null, { status: 503 });
          return HttpResponse.json({ ...emptyDnsJson, Answer: [answer("record-a")] });
        })
      )
    );
    server.listen();

    const out = await aliDnsResolver("ali.example.test");
    expect(out.Answer.map((r) => r.data)).toEqual(["record-a"]);
  });

  test("throws when all Ali DNS endpoints return non-2xx", async () => {
    server = setupServer(
      ...ALI_HOSTS.map((host) => http.get(`https://${host}/resolve`, () => new HttpResponse(null, { status: 503 })))
    );
    server.listen();

    await expect(aliDnsResolver("ali.example.test")).rejects.toThrow(/HTTP 503/);
  });

  test("throws when domain is empty", async () => {
    await expect(aliDnsResolver("")).rejects.toThrow("Domain is required");
  });
});

describe("proxyDnsResolver", () => {
  let server: SetupServerApi | undefined;

  afterEach(() => {
    server?.close();
  });

  test("requests proxy DNS JSON with name, TXT type, and encoded query", async () => {
    server = setupServer(
      http.get("https://dns.opencerts.io/resolve", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("name")).toBe("oc example.test");
        expect(url.searchParams.get("type")).toBe("TXT");
        return HttpResponse.json(emptyDnsJson);
      })
    );
    server.listen();

    const out = await proxyDnsResolver("oc example.test");
    expect(out).toMatchObject({ Status: 0, Answer: [] });
  });

  test("throws when proxy DNS returns non-2xx", async () => {
    server = setupServer(http.get("https://dns.opencerts.io/resolve", () => new HttpResponse(null, { status: 502 })));
    server.listen();

    await expect(proxyDnsResolver("oc.example.test")).rejects.toThrow(/HTTP 502/);
  });

  test("throws when domain is empty", async () => {
    await expect(proxyDnsResolver("")).rejects.toThrow("Domain is required");
  });
});
