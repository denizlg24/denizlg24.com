import { afterEach, expect, mock, test } from "bun:test";

mock.module("./health-check-credential", () => ({
  healthCheckHeaders: async (url: string, credentialId?: string) => {
    if (!credentialId) return {};
    if (
      credentialId !== "dr-synthetic" ||
      url !== "https://api.denizlg24.com/healthz/deep"
    ) {
      throw new Error("Health credential is not allowed for this endpoint");
    }
    return { "X-DR-Synthetic-Token": "test-only" };
  },
}));
const { runSubResourceCheck } = await import("./sub-resource-check");
const { parseSubResourceCheck } = await import("./sub-resource-payload");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const deep = {
  type: "http" as const,
  url: "https://api.denizlg24.com/healthz/deep",
  credentialId: "dr-synthetic" as const,
  expectStatus: 200,
  expectEquals: "ok",
};

test("one authenticated transaction feeds component rows without cascading a failure", async () => {
  const fetcher = mock(
    async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({
        "X-DR-Synthetic-Token": "test-only",
      });
      return Response.json(
        {
          status: "down",
          checks: { postgres: { status: "ok" }, search: { status: "down" } },
        },
        { status: 503 },
      );
    },
  );
  globalThis.fetch = fetcher as unknown as typeof fetch;
  const responses = new Map<string, Promise<Response>>();
  expect(
    (
      await runSubResourceCheck(
        { ...deep, expectJsonPath: "checks.postgres.status" },
        responses,
      )
    ).isHealthy,
  ).toBe(true);
  expect(
    (
      await runSubResourceCheck(
        { ...deep, expectJsonPath: "checks.search.status" },
        responses,
      )
    ).isHealthy,
  ).toBe(false);
  expect(
    (
      await runSubResourceCheck(
        { ...deep, expectJsonPath: "status" },
        responses,
      )
    ).isHealthy,
  ).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("credentials cannot be sent to another origin or path", async () => {
  const fetcher = mock(async () => Response.json({ status: "ok" }));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  for (const url of [
    "https://attacker.example",
    "https://api.denizlg24.com/redirect",
  ]) {
    expect(
      parseSubResourceCheck({ ...deep, url, expectJsonPath: "status" }),
    ).toHaveProperty("error");
    expect(
      (await runSubResourceCheck({ ...deep, url, expectJsonPath: "status" }))
        .isHealthy,
    ).toBe(false);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test("a named credential survives check parsing without exposing a token", () => {
  const parsed = parseSubResourceCheck({
    ...deep,
    expectJsonPath: "checks.redis.status",
  });
  expect(parsed).toEqual({
    value: { ...deep, expectJsonPath: "checks.redis.status" },
  });
  expect(JSON.stringify(parsed)).not.toContain("test-only");
});
