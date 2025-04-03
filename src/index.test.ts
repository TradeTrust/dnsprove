import { setupServer, SetupServerApi } from "msw/node";
import { http, HttpResponse } from "msw";
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
    Status: 0,
    TC: false,
    RD: true,
    RA: true,
    AD: true,
    CD: false,
    Question: [{ name: "donotuse.openattestation.com.", type: 16 }],
    Answer: [
      {
        name: "donotuse.openattestation.com.",
        type: 16,
        TTL: 300,
        data: "openatts a=dns-did; p=did:ethr:0xE712878f6E8d5d4F9e87E10DA604F9cB564C9a89#controller; v=1.0;",
      },
      {
        name: "donotuse.openattestation.com.",
        type: 16,
        TTL: 300,
        data:
          "openatts DO NOT ADD ANY RECORDS BEYOND THIS AS THIS DOMAIN IS USED FOR DNSPROVE NPM LIBRARY INTEGRATION TESTS",
      },
      {
        name: "donotuse.openattestation.com.",
        type: 16,
        TTL: 300,
        data: "openatts fooooooobarrrrrrrrr this entry exists to ensure validation works",
      },
      {
        name: "donotuse.openattestation.com.",
        type: 16,
        TTL: 300,
        data: "openatts net=ethereum netId=3 addr=0x2f60375e8144e16Adf1979936301D8341D58C36C",
      },
    ],
    Comment: "Response from 205.251.199.177.",
  };

  const testDnsResolvers: CustomDnsResolver[] = [
    async (domain) => {
      const data = await fetch(`https://dns.google/resolve?name=${domain}&type=TXT`, {
        method: "GET",
      });

      return data.json();
    },
    async (domain) => {
      const data = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=TXT`, {
        method: "GET",
        headers: { accept: "application/dns-json", contentType: "application/json", connection: "keep-alive" },
      });
      return data.json();
    },
  ];

  afterEach(() => {
    server.close();
  });

  test("Should work for first dns if first dns is not down", async () => {
    const handlers = [
      http.get("https://dns.google/resolve", (_) => {
        return HttpResponse.json(sampleResponse);
      }),
    ];

    server = setupServer(...handlers);
    server.listen();

    const records = await queryDns("https://donotuse.openattestation.com", testDnsResolvers);
    const sortedAnswer = records?.Answer.sort((a, b) => a.data.localeCompare(b.data));
    expect(sortedAnswer).toMatchObject(sampleResponse.Answer);
  });

  test("Should fallback to second dns when first dns is down", async () => {
    const handlers = [
      http.get("https://dns.google/resolve", (_) => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get("https://cloudflare-dns.com/dns-query", (_) => {
        return HttpResponse.json(sampleResponse);
      }),
    ];
    server = setupServer(...handlers);
    server.listen();

    const records = await queryDns("https://donotuse.openattestation.com", testDnsResolvers);

    const sortedAnswer = records?.Answer.sort((a, b) => a.data.localeCompare(b.data));
    expect(sortedAnswer).toMatchObject(sampleResponse.Answer);
  });

  test("Should throw error when all dns provided are down", async () => {
    const handlers = [
      http.get("https://dns.google/resolve", (_) => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get("https://cloudflare-dns.com/dns-query", (_) => {
        return new HttpResponse(null, { status: 500 });
      }),
    ];
    server = setupServer(...handlers);
    server.listen();
    try {
      await queryDns("https://donotuse.openattestation.com", testDnsResolvers);
    } catch (e: any) {
      expect(e.code).toStrictEqual(DnsproveStatusCode.IDNS_QUERY_ERROR_GENERAL);
    }
  });
});

describe("getDocumentStoreRecords for AstronTestnet", () => {
  const sampleDnsTextRecord = [
    {
      type: "openatts",
      net: "ethereum",
      netId: "21002",
      addr: "0xb1Bf514b3893357813F366282E887eE221D5C2dA",
      dnssec: false,
    },
    {
      type: "openatts",
      net: "ethereum",
      netId: "21002",
      addr: "0xdAEe89A37fEEBCBFAc94aBA63Fb163808dAc38Fb",
      dnssec: false,
    },
  ];

  test("it should work with dev-astronlayer2.bitfactory.cn", async () => {
    const records = (await getDocumentStoreRecords("dev-astronlayer2.bitfactory.cn")).sort((a, b) => {
      if (a.netId < b.netId) return -1;
      if (a.netId > b.netId) return 1;
      if (a.addr < b.addr) return -1;
      if (a.addr > b.addr) return 1;
      return 0;
    });

    expect(records).toStrictEqual(sampleDnsTextRecord);
  });
});

describe("getDocumentStoreRecords for Astron", () => {
  const sampleDnsTextRecord = [
    {
      type: "openatts",
      net: "ethereum",
      netId: "1338",
      addr: "0x0D5da59B93e8AC9b1781CE5694fbcE626586F4c9",
      dnssec: false,
    },
    {
      type: "openatts",
      net: "ethereum",
      netId: "1338",
      addr: "0x94FD21A026E29E0686583b8be71Cb28a8ca1A8d4",
      dnssec: false,
    },
  ];

  test("it should work with astronlayer2.bitfactory.cn", async () => {
    const records = (await getDocumentStoreRecords("astronlayer2.bitfactory.cn")).sort((a, b) => {
      if (a.netId < b.netId) return -1;
      if (a.netId > b.netId) return 1;
      if (a.addr < b.addr) return -1;
      if (a.addr > b.addr) return 1;
      return 0;
    });

    expect(records).toStrictEqual(sampleDnsTextRecord);
  });
});
