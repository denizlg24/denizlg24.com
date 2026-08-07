import { describe, expect, test } from "bun:test";

import { ControlPlaneClient, ControlPlaneError } from "./control-plane";

const TOKEN = "t".repeat(48);
const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111";

function client(handler: (request: Request) => Promise<Response>) {
  const stub = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(input as string, init))) as typeof fetch;
  return new ControlPlaneClient({
    baseUrl: "https://api.denizlg24.com/",
    token: TOKEN,
    fetchImplementation: stub,
  });
}

describe("ControlPlaneClient.claim", () => {
  test("reads null when there is nothing queued", async () => {
    const control = client(async () => Response.json({ deployment: null }));
    expect(await control.claim()).toBeNull();
  });

  test("surfaces a non-2xx as a typed error", async () => {
    const control = client(async () => new Response("nope", { status: 401 }));
    await expect(control.claim()).rejects.toBeInstanceOf(ControlPlaneError);
  });
});

describe("ControlPlaneClient.env", () => {
  test("presents the agent token on the env route", async () => {
    let seen: Request | null = null;
    const control = client(async (request) => {
      seen = request;
      return Response.json({
        deploymentId: DEPLOYMENT_ID,
        kind: "production",
        cloneToken: null,
        buildEnv: { NEXT_PUBLIC_URL: "https://app.denizlg24.com" },
        runEnv: { PORT: "3000", POSTGRES_PRISMA_URL: "postgresql://x" },
      });
    });
    const resolved = await control.env(DEPLOYMENT_ID);
    const request = seen as unknown as Request;
    expect(request.url).toBe(
      `https://api.denizlg24.com/api/deploy/agent/deployments/${DEPLOYMENT_ID}/env`,
    );
    expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(resolved.runEnv.POSTGRES_PRISMA_URL).toBe("postgresql://x");
    expect(resolved.buildEnv.NEXT_PUBLIC_URL).toBe("https://app.denizlg24.com");
  });

  test("rejects a response that does not match the contract", async () => {
    const control = client(async () =>
      Response.json({ deploymentId: DEPLOYMENT_ID, runEnv: { PORT: 3000 } }),
    );
    await expect(control.env(DEPLOYMENT_ID)).rejects.toThrow();
  });
});
