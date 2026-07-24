import { afterAll, describe, expect, it } from "bun:test";

import { getMongotHealth, normalizeVectorIndex } from "./vector-indexes";

describe("mongot vector index integration", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterAll(() => server?.stop(true));

  it("normalizes the MongoDB 8.2 listSearchIndexes contract", () => {
    expect(
      normalizeVectorIndex("documents", {
        name: "embeddings",
        status: "READY",
        queryable: true,
        latestDefinition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 1536,
              similarity: "cosine",
              quantization: "scalar",
            },
            { type: "filter", path: "tenantId" },
          ],
        },
      }),
    ).toEqual({
      collection: "documents",
      name: "embeddings",
      status: "READY",
      queryable: true,
      path: "embedding",
      numDimensions: 1536,
      similarity: "cosine",
      quantization: "scalar",
      filterPaths: ["tenantId"],
    });
  });

  it("uses mongot's documented /ready endpoint", async () => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        return new Response(
          new URL(request.url).pathname === "/ready" ? "ready" : "missing",
          {
            status: new URL(request.url).pathname === "/ready" ? 200 : 404,
          },
        );
      },
    });
    expect(await getMongotHealth(`http://127.0.0.1:${server.port}`)).toEqual({
      status: "ready",
    });
  });
});
