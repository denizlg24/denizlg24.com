import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextResponse } from "next/server";

const requireAdminMock = mock(
  async (): Promise<NextResponse<{ error: string }> | null> => null,
);
const revalidatePublicContentMock = mock((targets: string[]) => [
  ...new Set(targets),
]);

mock.module("@/lib/require-admin", () => ({
  requireAdmin: requireAdminMock,
}));

mock.module("@/lib/public-content-revalidation", () => ({
  PUBLIC_CONTENT_TARGETS: ["blog", "now", "projects", "timeline"],
  revalidatePublicContent: revalidatePublicContentMock,
}));

const { POST } = await import("./route");

function buildRequest(
  body: unknown,
  headers?: HeadersInit,
): Parameters<typeof POST>[0] {
  return new Request("http://localhost/api/admin/revalidate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/revalidate", () => {
  const originalSecret = process.env.REVALIDATE_SECRET;

  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue(null);
    revalidatePublicContentMock.mockReset();
    revalidatePublicContentMock.mockImplementation((targets: string[]) => [
      ...new Set(targets),
    ]);
    process.env.REVALIDATE_SECRET = "test-secret";
  });

  afterAll(() => {
    process.env.REVALIDATE_SECRET = originalSecret;
  });

  test("accepts valid admin auth", async () => {
    const response = await POST(buildRequest({ targets: ["blog"] }));

    expect(response.status).toBe(200);
    expect(revalidatePublicContentMock).toHaveBeenCalledWith(["blog"]);
    expect(await response.json()).toEqual({
      success: true,
      targets: ["blog"],
    });
  });

  test("accepts a valid x-revalidate-secret without admin auth", async () => {
    requireAdminMock.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(
      buildRequest(
        { targets: ["now"] },
        { "x-revalidate-secret": "test-secret" },
      ),
    );

    expect(response.status).toBe(200);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(revalidatePublicContentMock).toHaveBeenCalledWith(["now"]);
  });

  test("rejects missing auth", async () => {
    requireAdminMock.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(buildRequest({ targets: ["projects"] }));

    expect(response.status).toBe(401);
    expect(revalidatePublicContentMock).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid body shape", async () => {
    const response = await POST(buildRequest({ target: ["blog"] }));

    expect(response.status).toBe(400);
    expect(revalidatePublicContentMock).not.toHaveBeenCalled();
  });

  test("returns 400 for unknown targets", async () => {
    const response = await POST(buildRequest({ targets: ["unknown"] }));

    expect(response.status).toBe(400);
    expect(revalidatePublicContentMock).not.toHaveBeenCalled();
  });

  test("invalidates multiple targets in one call", async () => {
    const response = await POST(
      buildRequest({ targets: ["blog", "projects"] }),
    );

    expect(response.status).toBe(200);
    expect(revalidatePublicContentMock).toHaveBeenCalledWith([
      "blog",
      "projects",
    ]);
    expect(await response.json()).toEqual({
      success: true,
      targets: ["blog", "projects"],
    });
  });
});
