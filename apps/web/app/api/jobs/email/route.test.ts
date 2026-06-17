import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const connectDBMock = mock(async () => {});
const syncInboxMock = mock(async (_account: unknown) => 0);
const leanMock = mock(async (): Promise<unknown[]> => []);
const findMock = mock(() => ({ lean: leanMock }));
const findByIdAndUpdateMock = mock(async () => {});

mock.module("@/lib/mongodb", () => ({
  connectDB: connectDBMock,
}));

mock.module("@/lib/sync-email", () => ({
  syncInbox: syncInboxMock,
}));

mock.module("@/models/EmailAccount", () => ({
  EmailAccountModel: {
    find: findMock,
    findByIdAndUpdate: findByIdAndUpdateMock,
  },
}));

const { GET } = await import("./route");

function buildRequest(headers?: HeadersInit): Parameters<typeof GET>[0] {
  return new Request("http://localhost/api/jobs/email", {
    method: "GET",
    headers,
  });
}

describe("GET /api/jobs/email", () => {
  const originalToken = process.env.EMAIL_JOB_BEARER_TOKEN;

  beforeEach(() => {
    connectDBMock.mockClear();
    syncInboxMock.mockReset();
    syncInboxMock.mockResolvedValue(0);
    leanMock.mockReset();
    leanMock.mockResolvedValue([]);
    findMock.mockClear();
    findMock.mockImplementation(() => ({ lean: leanMock }));
    findByIdAndUpdateMock.mockReset();
    findByIdAndUpdateMock.mockResolvedValue(undefined);
    process.env.EMAIL_JOB_BEARER_TOKEN = "test-token";
  });

  afterAll(() => {
    process.env.EMAIL_JOB_BEARER_TOKEN = originalToken;
  });

  test("rejects requests without a valid Bearer token", async () => {
    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    expect(syncInboxMock).not.toHaveBeenCalled();
  });

  test("returns 500 when every account fails to sync", async () => {
    leanMock.mockResolvedValue([
      { _id: "1", user: "a@example.com" },
      { _id: "2", user: "b@example.com" },
    ]);
    syncInboxMock.mockRejectedValue(new Error("IMAP down"));

    const response = await GET(
      buildRequest({ Authorization: "Bearer test-token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.failedCount).toBe(2);
    expect(body.syncedCount).toBe(0);
  });

  test("returns 200 on partial failure", async () => {
    leanMock.mockResolvedValue([
      { _id: "1", user: "a@example.com" },
      { _id: "2", user: "b@example.com" },
    ]);
    syncInboxMock.mockResolvedValueOnce(10);
    syncInboxMock.mockRejectedValueOnce(new Error("IMAP down"));

    const response = await GET(
      buildRequest({ Authorization: "Bearer test-token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.syncedCount).toBe(1);
    expect(body.failedCount).toBe(1);
  });

  test("returns 200 when all accounts succeed", async () => {
    leanMock.mockResolvedValue([
      { _id: "1", user: "a@example.com" },
      { _id: "2", user: "b@example.com" },
    ]);
    syncInboxMock.mockResolvedValue(10);

    const response = await GET(
      buildRequest({ Authorization: "Bearer test-token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.syncedCount).toBe(2);
    expect(body.failedCount).toBe(0);
  });

  test("returns 200 when no accounts are configured", async () => {
    leanMock.mockResolvedValue([]);

    const response = await GET(
      buildRequest({ Authorization: "Bearer test-token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.syncedCount).toBe(0);
    expect(body.failedCount).toBe(0);
  });
});
