import { beforeEach, describe, expect, mock, test } from "bun:test";
import { llmModelsResponseSchema } from "@repo/schemas";
import { NextRequest, NextResponse } from "next/server";
import { CatalogUnavailableError } from "@/lib/llm-errors";
import {
  getModelCatalogResponse,
  type ModelCatalogRouteDependencies,
} from "./route";

const requireAdminMock = mock(async () => null as NextResponse | null);

const listModelsMock = mock(
  async (_filter?: { creator?: string; requiredTags?: string[] }) => ({
    models: [
      {
        id: "anthropic/claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        creator: "anthropic",
        type: "language",
        tags: ["tool-use", "web-search"],
        contextWindow: 200000,
        maxTokens: 64000,
        pricing: { input: 0.000001, output: 0.000005, hasTiers: false },
      },
    ],
    stale: false,
    fetchedAt: new Date("2026-07-13T10:00:00Z"),
  }),
);
const dependencies: ModelCatalogRouteDependencies = {
  requireAdmin: requireAdminMock,
  listModels: listModelsMock,
};

const GET = (request: NextRequest) =>
  getModelCatalogResponse(request, dependencies);

function buildRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/admin/llm/models${query}`);
}

beforeEach(() => {
  requireAdminMock.mockClear();
  requireAdminMock.mockResolvedValue(null);
  listModelsMock.mockClear();
});

describe("GET /api/admin/llm/models", () => {
  test("requires admin auth", async () => {
    requireAdminMock.mockResolvedValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }),
    );
    const response = await GET(buildRequest());
    expect(response.status).toBe(403);
    expect(listModelsMock).not.toHaveBeenCalled();
  });

  test("returns models validated by the shared schema", async () => {
    const response = await GET(buildRequest());
    expect(response.status).toBe(200);
    const body = llmModelsResponseSchema.parse(await response.json());
    expect(body.models[0]?.id).toBe("anthropic/claude-haiku-4.5");
    expect(body.stale).toBe(false);
    expect(body.fetchedAt).toBe("2026-07-13T10:00:00.000Z");
    // Only base prices cross the wire — no cache/tier internals.
    expect(body.models[0]?.pricing).toEqual({
      input: 0.000001,
      output: 0.000005,
    });
  });

  test("passes creator and capability filters to the service", async () => {
    const response = await GET(
      buildRequest(
        "?creator=anthropic&requiredCapability=tool-use&requiredCapability=web-search",
      ),
    );
    expect(response.status).toBe(200);
    expect(listModelsMock).toHaveBeenCalledWith({
      creator: "anthropic",
      requiredTags: ["tool-use", "web-search"],
    });
  });

  test("rejects unknown query filters", async () => {
    const response = await GET(buildRequest("?url=https://evil.example"));
    expect(response.status).toBe(400);
    expect(listModelsMock).not.toHaveBeenCalled();
  });

  test("marks stale catalog data in the response", async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [],
      stale: true,
      fetchedAt: new Date("2026-07-13T09:00:00Z"),
    });
    const body = await (await GET(buildRequest())).json();
    expect(body.stale).toBe(true);
  });

  test("returns 503 when the catalog is cold", async () => {
    listModelsMock.mockRejectedValueOnce(
      new CatalogUnavailableError("catalog down"),
    );
    const response = await GET(buildRequest());
    expect(response.status).toBe(503);
  });

  test("returns 500 on unexpected failures", async () => {
    listModelsMock.mockRejectedValueOnce(new Error("boom"));
    const response = await GET(buildRequest());
    expect(response.status).toBe(500);
  });
});
