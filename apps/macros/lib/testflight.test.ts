import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

const calls: Array<{ method: string; url: string; body: unknown }> = [];
let responses: Response[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.MACROS_ASC_KEY_ID = "KEY123";
  process.env.MACROS_ASC_ISSUER_ID = "issuer";
  process.env.MACROS_ASC_PRIVATE_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
    .replace(/\n/g, "\\n");
  process.env.MACROS_TESTFLIGHT_GROUP_ID = "group-1";
  globalThis.fetch = Object.assign(
    mock(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    }),
    { preconnect: realFetch.preconnect },
  );
});

afterEach(() => {
  calls.length = 0;
  responses = [];
});

describe("inviteToTestFlight", () => {
  test("creates the tester inside the public group", async () => {
    const { inviteToTestFlight } = await import("./testflight");
    responses = [new Response("{}", { status: 201 })];
    expect(
      await inviteToTestFlight({ email: "a@example.com", firstName: "A" }),
    ).toEqual({ status: "invited" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toEndWith("/v1/betaTesters");
    expect(calls[0]?.body).toMatchObject({
      data: {
        attributes: { email: "a@example.com", firstName: "A" },
        relationships: {
          betaGroups: { data: [{ type: "betaGroups", id: "group-1" }] },
        },
      },
    });
  });

  test("adds a tester Apple already knows to the group", async () => {
    const { inviteToTestFlight } = await import("./testflight");
    responses = [
      new Response("{}", { status: 409 }),
      Response.json({ data: [] }),
      Response.json({ data: [{ id: "tester-9" }] }),
      new Response(null, { status: 204 }),
    ];
    expect(await inviteToTestFlight({ email: "b@example.com" })).toEqual({
      status: "already-invited",
    });
    expect(calls[1]?.url).toContain("filter[betaGroups]=group-1");
    expect(calls[2]?.url).toContain("filter[email]=b%40example.com");
    expect(calls[2]?.url).not.toContain("filter[betaGroups]");
    expect(calls[3]?.url).toEndWith(
      "/v1/betaGroups/group-1/relationships/betaTesters",
    );
    expect(calls[3]?.body).toEqual({
      data: [{ type: "betaTesters", id: "tester-9" }],
    });
  });

  test("leaves a tester already in the group alone", async () => {
    const { inviteToTestFlight } = await import("./testflight");
    responses = [
      new Response("{}", { status: 409 }),
      Response.json({ data: [{ id: "tester-9" }] }),
    ];
    expect(await inviteToTestFlight({ email: "d@example.com" })).toEqual({
      status: "already-invited",
    });
    expect(calls).toHaveLength(2);
  });

  test("surfaces any other failure", async () => {
    const { inviteToTestFlight } = await import("./testflight");
    responses = [new Response("nope", { status: 403 })];
    await expect(
      inviteToTestFlight({ email: "c@example.com" }),
    ).rejects.toThrow("403");
  });
});
