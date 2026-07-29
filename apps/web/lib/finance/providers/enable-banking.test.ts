import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
} from "jose";
import {
  EnableBankingProvider,
  getEnableBankingJwt,
  parseDecimalMinor,
  resetEnableBankingJwtCacheForTests,
} from "./enable-banking";

let privateKeyBase64 = "";

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  privateKeyBase64 = Buffer.from(await exportPKCS8(privateKey)).toString(
    "base64",
  );
});

afterEach(() => {
  delete process.env.ENABLE_BANKING_APPLICATION_ID;
  delete process.env.ENABLE_BANKING_PRIVATE_KEY_B64;
  resetEnableBankingJwtCacheForTests();
});

function configureCredentials() {
  process.env.ENABLE_BANKING_APPLICATION_ID = "application-id";
  process.env.ENABLE_BANKING_PRIVATE_KEY_B64 = privateKeyBase64;
}

describe("Enable Banking adapter", () => {
  test("mints and caches the documented stateless RS256 JWT", async () => {
    configureCredentials();
    const now = new Date("2026-07-29T10:00:00.000Z");
    const first = await getEnableBankingJwt(now);
    const second = await getEnableBankingJwt(
      new Date("2026-07-29T10:01:00.000Z"),
    );

    expect(second).toBe(first);
    expect(decodeProtectedHeader(first)).toEqual({
      typ: "JWT",
      alg: "RS256",
      kid: "application-id",
    });
    expect(decodeJwt(first)).toMatchObject({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
    });
    expect((decodeJwt(first).exp ?? 0) - (decodeJwt(first).iat ?? 0)).toBe(300);
  });

  test("parses decimal strings without floating point arithmetic", () => {
    expect(parseDecimalMinor("1.23", "EUR")).toBe(123);
    expect(parseDecimalMinor("-12.3", "EUR")).toBe(-1_230);
    expect(parseDecimalMinor("250", "JPY")).toBe(250);
    expect(() => parseDecimalMinor("1.234", "EUR")).toThrow();
  });

  test("paginates transactions while preserving range parameters and headers", async () => {
    configureCredentials();
    const requests: Request[] = [];
    const beforeRequest = mock(async () => true);
    const fetchMock = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        const continuation = new URL(request.url).searchParams.get(
          "continuation_key",
        );
        return Response.json({
          transactions: [
            {
              transaction_amount: { amount: "10.00", currency: "EUR" },
              credit_debit_indicator: "DBIT",
              status: continuation ? "BOOK" : "PDNG",
              value_date: "2026-07-29",
              transaction_id: continuation ? "booked-id" : undefined,
              remittance_information: ["CARD PAYMENT Cafe"],
            },
          ],
          continuation_key: continuation ? null : "page-2",
        });
      },
    );
    const provider = new EnableBankingProvider({
      fetch: fetchMock as unknown as typeof fetch,
      context: {
        dateFrom: "2026-07-20",
        dateTo: "2026-07-29",
        psuIpAddress: "203.0.113.1",
        psuUserAgent: "Finance test",
        beforeRequest,
      },
    });

    const transactions = await provider.fetchTransactions("account-ref");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.amountMinor).toBe(-1_000);
    expect(transactions[1]?.status).toBe("booked");
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(
      requests.every(
        (request) =>
          new URL(request.url).searchParams.get("date_from") === "2026-07-20" &&
          request.headers.get("Psu-Ip-Address") === "203.0.113.1",
      ),
    ).toBe(true);
  });

  test("never sends date_to without date_from", async () => {
    configureCredentials();
    const requests: Request[] = [];
    const fetchMock = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return Response.json({ transactions: [], continuation_key: null });
      },
    );
    const provider = new EnableBankingProvider({
      fetch: fetchMock as unknown as typeof fetch,
      context: { dateTo: "2026-07-29", initialBackfill: true },
    });

    await provider.fetchTransactions("account-ref");
    const query = new URL(requests[0]!.url).searchParams;
    expect(query.get("date_from")).toBeNull();
    expect(query.get("date_to")).toBeNull();
    expect(query.get("strategy")).toBe("longest");
  });
});
