import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextResponse } from "next/server";

const requireAdminMock = mock(async () => null as NextResponse | null);
const connectDBMock = mock(async () => {});
const connectionLeanMock = mock(async (): Promise<unknown> => null);
const connectionFindOneMock = mock(() => ({ lean: connectionLeanMock }));
const pendingCountMock = mock(async () => 0);
const failedCountMock = mock(async () => 0);

mock.module("@/lib/require-admin", () => ({
  getAdminSession: mock(async () => ({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  })),
  requireAdmin: requireAdminMock,
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/models/CalendarExternalConnection", () => ({
  CalendarExternalConnection: {
    findOne: connectionFindOneMock,
    findOneAndUpdate: mock(async () => null),
    deleteOne: mock(async () => ({})),
  },
}));
mock.module("@/models/CalendarExternalEventSync", () => ({
  CalendarExternalEventSync: {
    countDocuments: mock((query: unknown) => {
      const text = JSON.stringify(query);
      return text.includes("pendingAction")
        ? pendingCountMock()
        : failedCountMock();
    }),
    deleteMany: mock(async () => ({})),
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  requireAdminMock.mockReset();
  requireAdminMock.mockResolvedValue(null);
  connectDBMock.mockClear();
  connectionLeanMock.mockReset();
  connectionLeanMock.mockResolvedValue(null);
  pendingCountMock.mockReset();
  pendingCountMock.mockResolvedValue(0);
  failedCountMock.mockReset();
  failedCountMock.mockResolvedValue(0);
});

describe("GET /api/admin/calendar/google", () => {
  test("redacts encrypted refresh token from status response", async () => {
    connectionLeanMock.mockResolvedValue({
      provider: "google",
      enabled: true,
      calendarId: "primary",
      accountEmail: "admin@example.com",
      scope: ["calendar"],
      encryptedRefreshToken: {
        ciphertext: "secret",
        iv: "iv",
        authTag: "tag",
      },
      connectedAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      lastSyncAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const response = await GET(
      new Request("http://localhost/api/admin/calendar/google") as Parameters<
        typeof GET
      >[0],
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connected).toBe(true);
    expect(body.encryptedRefreshToken).toBeUndefined();
  });
});
