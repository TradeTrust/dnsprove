import { setupServer, SetupServerApi } from "msw/node";
import { http, HttpResponse } from "msw";
import { aliDnsResolver } from "./ali-dns-resolver";
import { cloudflareDnsResolver } from "./cloudflare-dns-resolver";
import { googleDnsResolver } from "./google-dns-resolver";

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

  test("requests Ali DNS JSON with name, type 16 (TXT), and encoded query", async () => {
    server = setupServer(
      http.get("https://dns.alidns.com/resolve", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("name")).toBe("ali example.test");
        expect(url.searchParams.get("type")).toBe("16");
        return HttpResponse.json(emptyDnsJson);
      })
    );
    server.listen();

    const out = await aliDnsResolver("ali example.test");
    expect(out).toMatchObject({ Status: 0, Answer: [] });
  });

  test("throws when Ali DNS returns non-2xx", async () => {
    server = setupServer(http.get("https://dns.alidns.com/resolve", () => new HttpResponse(null, { status: 503 })));
    server.listen();

    await expect(aliDnsResolver("ali.example.test")).rejects.toThrow(/HTTP 503/);
  });

  test("throws when domain is empty", async () => {
    await expect(aliDnsResolver("")).rejects.toThrow("Domain is required");
  });
});
