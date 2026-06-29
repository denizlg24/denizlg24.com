import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const getAdminSessionMock = mock(
  async (): Promise<unknown> => ({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  }),
);
const connectDBMock = mock(async () => {});
const getTokenMock = mock(async (_code: string) => ({
  tokens: {
    refresh_token: "refresh-token",
    scope: "scope-a scope-b",
    id_token: "id.token",
  },
}));
const findOneAndUpdateMock = mock(async () => ({}));
const encryptedRefreshTokenMock = mock((refreshToken: string) => ({
  ciphertext: `encrypted:${refreshToken}`,
  iv: "iv",
  authTag: "tag",
}));

mock.module("@/lib/require-admin", () => ({
  getAdminSession: getAdminSessionMock,
  requireAdmin: mock(async () => null),
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/google-calendar", () => ({
  createGoogleCalendarOAuthClient: () => ({ getToken: getTokenMock }),
  encryptedRefreshToken: encryptedRefreshTokenMock,
  extractEmailFromIdToken: () => "admin@example.com",
  getGoogleCalendarAuthorizationUrl: () =>
    "https://accounts.google.com/o/oauth2",
  parseScope: () => ["scope-a", "scope-b"],
}));
mock.module("@/models/CalendarExternalConnection", () => ({
  CalendarExternalConnection: {
    findOneAndUpdate: findOneAndUpdateMock,
  },
}));

const { GET } = await import("./route");

function callbackRequest(url: string, cookieState = "state") {
  return new NextRequest(url, {
    headers: {
      cookie: `google_calendar_oauth_state=${cookieState}`,
    },
  });
}

beforeEach(() => {
  getAdminSessionMock.mockReset();
  getAdminSessionMock.mockResolvedValue({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  });
  connectDBMock.mockClear();
  getTokenMock.mockReset();
  getTokenMock.mockResolvedValue({
    tokens: {
      refresh_token: "refresh-token",
      scope: "scope-a scope-b",
      id_token: "id.token",
    },
  });
  findOneAndUpdateMock.mockReset();
  encryptedRefreshTokenMock.mockClear();
});

describe("GET /api/admin/calendar/google/callback", () => {
  test("rejects invalid OAuth state", async () => {
    const response = await GET(
      callbackRequest(
        "http://localhost/api/admin/calendar/google/callback?state=bad&code=ok",
        "good",
      ),
    );

    expect(response.status).toBe(307);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  test("rejects missing OAuth code", async () => {
    const response = await GET(
      callbackRequest(
        "http://localhost/api/admin/calendar/google/callback?state=state",
      ),
    );

    expect(response.status).toBe(307);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  test("persists encrypted refresh token without networked Google calls", async () => {
    const response = await GET(
      callbackRequest(
        "http://localhost/api/admin/calendar/google/callback?state=state&code=oauth-code",
      ),
    );

    expect(response.status).toBe(307);
    expect(getTokenMock).toHaveBeenCalledWith("oauth-code");
    expect(encryptedRefreshTokenMock).toHaveBeenCalledWith("refresh-token");
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { provider: "google" },
      expect.objectContaining({
        $set: expect.objectContaining({
          encryptedRefreshToken: {
            ciphertext: "encrypted:refresh-token",
            iv: "iv",
            authTag: "tag",
          },
        }),
      }),
      { upsert: true, returnDocument: "after" },
    );
  });
});
