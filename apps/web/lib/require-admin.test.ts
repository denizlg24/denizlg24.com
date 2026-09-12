import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CloudAccessToken } from "@repo/cloud-auth-client/resource";
import { NextRequest } from "next/server";

const COOKIE = "denizlg24-admin";

const findOneLeanMock = mock(async (): Promise<unknown> => null);
const findOneMock = mock(() => ({ lean: findOneLeanMock }));
const connectDBMock = mock(async () => {});
const verifyMock = mock(
  async (_token: string): Promise<CloudAccessToken | null> => null,
);
const openSessionMock = mock(
  async (
    value: string | undefined,
  ): Promise<{ at: string; rt: string; exp: number } | null> =>
    value ? { at: "session-at", rt: "rt", exp: 0 } : null,
);
const cookieValue = { current: undefined as string | undefined };
const forbiddenMock = mock((): never => {
  throw new Error("FORBIDDEN");
});
const redirectMock = mock((url: string): never => {
  throw new Error(`REDIRECT ${url}`);
});

mock.module("@/models/ApiKey", () => ({ default: { findOne: findOneMock } }));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("./admin-session", () => ({
  ADMIN_SESSION_COOKIE: COOKIE,
  openSession: openSessionMock,
  verifySiteAccessToken: verifyMock,
}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === COOKIE && cookieValue.current
        ? { name, value: cookieValue.current }
        : undefined,
  }),
}));
mock.module("next/navigation", () => ({
  forbidden: forbiddenMock,
  redirect: redirectMock,
}));

const { requireAdmin, getAdminSession, requireAdminPage } = await import(
  "./require-admin"
);

const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln";

function userToken(
  overrides: Partial<CloudAccessToken> = {},
): CloudAccessToken {
  return {
    subject: "7f1a0c52-0000-4000-8000-000000000001",
    clientId: "web",
    scopes: ["openid", "offline_access"],
    sessionId: "s1",
    machine: false,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    claims: { superuser: true },
    ...overrides,
  };
}

function buildRequest(
  options: { authorization?: string; cookie?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (options.authorization)
    headers.set("authorization", options.authorization);
  if (options.cookie) headers.set("cookie", `${COOKIE}=${options.cookie}`);
  return new NextRequest("https://denizlg24.com/api/admin/x", { headers });
}

beforeEach(() => {
  findOneMock.mockClear();
  findOneLeanMock.mockReset();
  findOneLeanMock.mockResolvedValue(null);
  verifyMock.mockReset();
  verifyMock.mockResolvedValue(null);
  forbiddenMock.mockClear();
  redirectMock.mockClear();
  cookieValue.current = undefined;
});

describe("getAdminSession", () => {
  test("a known API key is the admin, without touching token verification", async () => {
    findOneLeanMock.mockResolvedValue({ key: "hash" });

    const session = await getAdminSession(
      buildRequest({ authorization: "Bearer desktop-key" }),
    );

    expect(session?.via).toBe("api-key");
    expect(verifyMock).not.toHaveBeenCalled();
  });

  test("an access token for this site from a superuser grant is the admin", async () => {
    verifyMock.mockResolvedValue(userToken());

    const session = await getAdminSession(
      buildRequest({ authorization: `Bearer ${JWT}` }),
    );

    expect(session?.via).toBe("oauth");
    expect(findOneMock).not.toHaveBeenCalled();
  });

  test("a service client's token counts only with the superuser scope", async () => {
    verifyMock.mockResolvedValue(
      userToken({ machine: true, subject: "svc", clientId: "svc", scopes: [] }),
    );
    expect(
      await getAdminSession(buildRequest({ authorization: `Bearer ${JWT}` })),
    ).toBeNull();

    verifyMock.mockResolvedValue(
      userToken({
        machine: true,
        subject: "svc",
        clientId: "svc",
        scopes: ["superuser"],
        claims: {},
      }),
    );
    const session = await getAdminSession(
      buildRequest({ authorization: `Bearer ${JWT}` }),
    );
    expect(session?.user.email).toBe("client:svc");
  });

  test("the session cookie resolves through its access token", async () => {
    verifyMock.mockResolvedValue(userToken());

    const session = await getAdminSession(buildRequest({ cookie: "sealed" }));

    expect(session?.via).toBe("session");
    expect(verifyMock).toHaveBeenCalledWith("session-at");
  });

  test("an unverifiable session token is no session", async () => {
    verifyMock.mockResolvedValue(null);

    expect(
      await getAdminSession(buildRequest({ cookie: "sealed" })),
    ).toBeNull();
  });

  test("a bad bearer falls through to the cookie", async () => {
    verifyMock.mockImplementation(async (token) =>
      token === "session-at" ? userToken() : null,
    );

    const session = await getAdminSession(
      buildRequest({ authorization: `Bearer ${JWT}`, cookie: "sealed" }),
    );

    expect(session?.via).toBe("session");
  });
});

describe("requireAdmin", () => {
  test("no credentials is forbidden", async () => {
    await expect(requireAdmin(buildRequest())).rejects.toThrow("FORBIDDEN");
  });

  test("an admin resolves to null", async () => {
    findOneLeanMock.mockResolvedValue({ key: "hash" });
    expect(
      await requireAdmin(buildRequest({ authorization: "Bearer desktop-key" })),
    ).toBeNull();
  });
});

describe("requireAdminPage", () => {
  test("an admin session is returned", async () => {
    cookieValue.current = "sealed";
    verifyMock.mockResolvedValue(userToken());

    const session = await requireAdminPage("/admin/dashboard");

    expect(session.user.role).toBe("admin");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  test("a signed-out load is sent to sign in and back", async () => {
    await expect(requireAdminPage("/admin/voice")).rejects.toThrow(
      "REDIRECT /auth/login?callbackUrl=%2Fadmin%2Fvoice",
    );
    expect(forbiddenMock).not.toHaveBeenCalled();
  });
});
