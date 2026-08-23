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

  test("queries all Ali DNS endpoints with name and type 16 (TXT) and merges deduplicated answers", async () => {
    const requested: string[] = [];
    const handler = (host: string, records: ReturnType<typeof answer>[]) =>
      http.get(`https://${host}/resolve`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("name")).toBe("ali.example.test");
        expect(url.searchParams.get("type")).toBe("16");
        requested.push(`${url.host}${url.searchParams.has("edns_client_subnet") ? "+ecs" : ""}`);
        return HttpResponse.json({ ...emptyDnsJson, Answer: records });
      });

    server = setupServer(
      handler("dns.alidns.com", [answer("record-a")]),
      handler("223.5.5.5", [answer("record-a"), answer("record-b")]),
      handler("223.6.6.6", [answer("record-c")])
    );
    server.listen();

    const out = await aliDnsResolver("ali.example.test");
    const merged = out.Answer.map((r) => r.data).sort();
    expect(merged).toEqual(["record-a", "record-b", "record-c"]);
    expect(requested.sort()).toEqual(["223.5.5.5", "223.5.5.5+ecs", "223.6.6.6", "223.6.6.6+ecs", "dns.alidns.com"]);
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

  test("throws when all Ali DNS endpoints return non-2xx", async () => {
    server = setupServer(
      http.get("https://dns.alidns.com/resolve", () => new HttpResponse(null, { status: 503 })),
      http.get("https://223.5.5.5/resolve", () => new HttpResponse(null, { status: 503 })),
      http.get("https://223.6.6.6/resolve", () => new HttpResponse(null, { status: 503 }))
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
