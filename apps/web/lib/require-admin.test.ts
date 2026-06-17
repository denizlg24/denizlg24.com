import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

const findOneLeanMock = mock(async (): Promise<unknown> => null);
const findOneMock = mock(() => ({ lean: findOneLeanMock }));
const getServerSessionMock = mock(async (): Promise<unknown> => null);
const connectDBMock = mock(async () => {});
const forbiddenMock = mock((): never => {
  throw new Error("FORBIDDEN");
});

mock.module("@/models/ApiKey", () => ({ default: { findOne: findOneMock } }));
mock.module("@/lib/get-server-session", () => ({
  getServerSession: getServerSessionMock,
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("next/navigation", () => ({ forbidden: forbiddenMock }));

const { requireAdmin, getAdminSession } = await import("./require-admin");

function buildRequest(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) {
    headers.set("authorization", authorization);
  }
  return new Request("http://localhost", { headers }) as unknown as NextRequest;
}

beforeEach(() => {
  findOneLeanMock.mockReset();
  findOneLeanMock.mockResolvedValue(null);
  findOneMock.mockReset();
  findOneMock.mockImplementation(() => ({ lean: findOneLeanMock }));
  getServerSessionMock.mockReset();
  getServerSessionMock.mockResolvedValue(null);
  connectDBMock.mockReset();
  connectDBMock.mockResolvedValue(undefined);
  forbiddenMock.mockReset();
  forbiddenMock.mockImplementation((): never => {
    throw new Error("FORBIDDEN");
  });
});

describe("requireAdmin", () => {
  test("valid Bearer token resolves to null without hitting the session", async () => {
    findOneLeanMock.mockResolvedValue({ key: "hash" });

    const result = await requireAdmin(buildRequest("Bearer secret-token"));

    expect(result).toBeNull();
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  test("no auth header and no session calls forbidden() (throws)", async () => {
    getServerSessionMock.mockResolvedValue(null);

    await expect(requireAdmin(buildRequest())).rejects.toThrow("FORBIDDEN");
    expect(forbiddenMock).toHaveBeenCalled();
  });

  test("session with emailVerified false calls forbidden() (throws)", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { emailVerified: false, role: "admin" },
    });

    await expect(requireAdmin(buildRequest())).rejects.toThrow("FORBIDDEN");
    expect(forbiddenMock).toHaveBeenCalled();
  });

  test("verified non-admin session calls forbidden() (throws)", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { emailVerified: true, role: "user" },
    });

    await expect(requireAdmin(buildRequest())).rejects.toThrow("FORBIDDEN");
    expect(forbiddenMock).toHaveBeenCalled();
  });

  test("verified admin session resolves to null", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { emailVerified: true, role: "admin" },
    });

    const result = await requireAdmin(buildRequest());

    expect(result).toBeNull();
    expect(forbiddenMock).not.toHaveBeenCalled();
  });
});

describe("getAdminSession", () => {
  test("valid Bearer token returns synthetic admin session without throwing", async () => {
    findOneLeanMock.mockResolvedValue({ key: "hash" });

    const result = await getAdminSession(buildRequest("Bearer secret-token"));

    expect(result).toEqual({
      user: { email: "admin-token", role: "admin", emailVerified: true },
    });
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  test("no session returns null instead of throwing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const result = await getAdminSession(buildRequest());

    expect(result).toBeNull();
    expect(forbiddenMock).not.toHaveBeenCalled();
  });

  test("non-admin session returns null", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { emailVerified: true, role: "user" },
    });

    const result = await getAdminSession(buildRequest());

    expect(result).toBeNull();
    expect(forbiddenMock).not.toHaveBeenCalled();
  });
});
