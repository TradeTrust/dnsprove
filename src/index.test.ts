import axios from "axios";
import { setupServer, SetupServerApi } from "msw/node";
import { rest } from "msw";
import { CustomDnsResolver, getDocumentStoreRecords, queryDns, parseDocumentStoreResults, getDnsDidRecords } from ".";
import { DnsproveStatusCode } from "./common/error";

describe("getCertStoreRecords", () => {
  const sampleDnsTextRecordWithDnssec = {
    type: "openatts",
    net: "ethereum",
    netId: "3",
    dnssec: true,
    addr: "0x2f60375e8144e16Adf1979936301D8341D58C36C",
  };
  test("it should work", async () => {
    const records = await getDocumentStoreRecords("donotuse.openattestation.com");
    expect(records).toStrictEqual([sampleDnsTextRecordWithDnssec]);
  });

  test("it should return an empty array if there is no openatts record", async () => {
    expect(await getDocumentStoreRecords("google.com")).toStrictEqual([]);
  });

  test("it should return an empty array with a non-existent domain", async () => {
    expect(await getDocumentStoreRecords("thisdoesnotexist.gov.sg")).toStrictEqual([]);
  });
});

describe("getDnsDidRecords", () => {
  test("it should work", async () => {
    const records = await getDnsDidRecords("donotuse.openattestation.com");
    expect(records).toStrictEqual([
      {
        type: "openatts",
        algorithm: "dns-did",
        publicKey: "did:ethr:0xE712878f6E8d5d4F9e87E10DA604F9cB564C9a89#controller",
        version: "1.0",
        dnssec: true,
      },
    ]);
  });

  test("it should return an empty array if there is no openatts record", async () => {
    const records = await getDnsDidRecords("google.com");
    expect(records).toStrictEqual([]);
  });

  test("it should return an empty array with a non-existent domain", async () => {
    const records = await getDnsDidRecords("thisdoesnotexist.gov.sg");
    expect(records).toStrictEqual([]);
  });
});

describe("parseDocumentStoreResults", () => {
  test("it should return one record in an array if there is one openatts record", () => {
    const sampleRecord = [
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts net=ethereum netId=3 addr=0x2f60375e8144e16Adf1979936301D8341D58C36C"',
        dnssec: true,
      },
    ];
    expect(parseDocumentStoreResults(sampleRecord, true)).toStrictEqual([
      {
        type: "openatts",
        net: "ethereum",
        netId: "3",
        addr: "0x2f60375e8144e16Adf1979936301D8341D58C36C",
        dnssec: true,
      },
    ]);
  });
  test("it should correctly handle cases where the TXT record is not double quoted", () => {
    const sampleRecord = [
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: "openatts net=ethereum netId=3 addr=0x2f60375e8144e16Adf1979936301D8341D58C36C",
        dnssec: true,
      },
    ];
    expect(parseDocumentStoreResults(sampleRecord, true)).toStrictEqual([
      {
        type: "openatts",
        net: "ethereum",
        netId: "3",
        addr: "0x2f60375e8144e16Adf1979936301D8341D58C36C",
        dnssec: true,
      },
    ]);
  });
  test("it should return two record items if there are two openatts record", () => {
    const sampleRecord = [
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts net=ethereum netId=3 addr=0x2f60375e8144e16Adf1979936301D8341D58C36C"',
        dnssec: true,
      },
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts net=ethereum netId=1 addr=0x007d40224f6562461633ccfbaffd359ebb2fc9ba"',
        dnssec: true,
      },
    ];

    expect(parseDocumentStoreResults(sampleRecord, true)).toStrictEqual([
      {
        addr: "0x2f60375e8144e16Adf1979936301D8341D58C36C",
        net: "ethereum",
        netId: "3",
        type: "openatts",
        dnssec: true,
      },
      {
        addr: "0x007d40224f6562461633ccfbaffd359ebb2fc9ba",
        net: "ethereum",
        netId: "1",
        type: "openatts",
        dnssec: true,
      },
    ]);
  });
  test("it should omit malformed records even if it has openatts header", () => {
    const sampleRecord = [
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts foobarbar"',
        dnssec: true,
      },
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts net=ethereum netId=1 addr=0x007d40224f6562461633ccfbaffd359ebb2fc9ba"',
        dnssec: true,
      },
    ];
    expect(parseDocumentStoreResults(sampleRecord, true)).toStrictEqual([
      {
        addr: "0x007d40224f6562461633ccfbaffd359ebb2fc9ba",
        net: "ethereum",
        netId: "1",
        type: "openatts",
        dnssec: true,
      },
    ]);
  });
  test("should not return a record if addr fails ethereum regex", () => {
    const sampleRecord = [
      {
        name: "example.openattestation.com.",
        type: 16,
        TTL: 110,
        data: '"openatts net=ethereum netId=3 addr=0x2f60375e8144e16Adf19=79936301D8341D58C36C"',
        dnssec: true,
      },
    ];
    expect(parseDocumentStoreResults(sampleRecord, true)).toStrictEqual([]);
  });
});

describe("queryDns", () => {
  let server: SetupServerApi;

  const sampleResponse = {
    AD: false,
    Answer: [
      {
        name: "google.com",
        type: 16,
        TTL: 3529,
        data: '"docusign=1b0a6754-49b1-4db5-8540-d2c12664b289"',
      },
    ],
  };

  const testDnsResolvers: CustomDnsResolver[] = [
    async (domain) => {
      const { data } = await axios({
        method: "GET",
        url: `https://dns.google/resolve?name=${domain}&type=TXT`,
      });

      return data;
    },
    async (domain) => {
      const { data } = await axios({
        method: "GET",
        url: `https://cloudflare-dns.com/dns-query?name=${domain}&type=TXT`,
        headers: { accept: "application/dns-json", contentType: "application/json", connection: "keep-alive" },
      });
      return data;
    },
  ];

  afterEach(() => {
    server.close();
  });

  test("Should work for first dns if first dns is not down", async () => {
    const handlers = [
      rest.get("https://dns.google/resolve", (_, res, ctx) => {
        return res(ctx.json(sampleResponse));
      }),
    ];

    server = setupServer(...handlers);
    server.listen();

    const records = await queryDns("https://google.com", testDnsResolvers);
    expect(sampleResponse).toStrictEqual(records);
  });

  test("Should fallback to second dns when first dns is down", async () => {
    const handlers = [
      rest.get("https://dns.google/resolve", (_, res, ctx) => {
        return res(ctx.status(500));
      }),
      rest.get("https://cloudflare-dns.com/dns-query", (_, res, ctx) => {
        return res(ctx.json(sampleResponse));
      }),
    ];
    server = setupServer(...handlers);
    server.listen();

    const records = await queryDns("https://google.com", testDnsResolvers);

    expect(sampleResponse).toStrictEqual(records);
  });

  test("Should throw error when all dns provided are down", async () => {
    const handlers = [
      rest.get("https://dns.google/resolve", (_, res, ctx) => {
        return res(ctx.status(500));
      }),
      rest.get("https://cloudflare-dns.com/dns-query", (_, res, ctx) => {
        return res(ctx.status(500));
      }),
    ];
    server = setupServer(...handlers);
    server.listen();
    try {
      await queryDns("https://google.com", testDnsResolvers);
    } catch (e: any) {
      expect(e.code).toStrictEqual(DnsproveStatusCode.IDNS_QUERY_ERROR_GENERAL);
    }
  });
});

describe("getDocumentStoreRecords for Hedera", () => {
  const sampleDnsTextRecord = {
    type: "openatts",
    net: "hedera",
    netId: "296",
    dnssec: false,
    addr: "0x3DE43bfd3D771931E46CbBd4EDE0D3d95C85f81A",
  };

  test("it should work with trustlv.org", async () => {
    const records = await getDocumentStoreRecords("trustlv.org");
    expect(records).toStrictEqual([sampleDnsTextRecord]);
  });
});
