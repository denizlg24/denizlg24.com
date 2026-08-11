import { describe, expect, it } from "bun:test";

import { forgeDeploymentQuerySchema } from "./forge";

/**
 * The forge deployments page parses the URL through this schema, so a hand-
 * edited or stale query string reaches it before anything validates it.
 */
describe("forgeDeploymentQuerySchema", () => {
  it("falls back to the newest first page", () => {
    expect(forgeDeploymentQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
      sort: "createdAt",
      direction: "desc",
      status: [],
      project: null,
      search: null,
      kind: null,
      branch: null,
      repo: null,
      since: null,
      until: null,
    });
  });

  it("keeps a one-sided date range", () => {
    const query = forgeDeploymentQuerySchema.parse({
      since: "2026-08-01T00:00:00.000Z",
    });
    expect(query.since).toBe("2026-08-01T00:00:00.000Z");
    expect(query.until).toBeNull();
  });

  it("refuses a kind that is not a deployment kind", () => {
    expect(() =>
      forgeDeploymentQuerySchema.parse({ kind: "staging" }),
    ).toThrow();
  });

  it("coerces the numbers a query string carries as text", () => {
    const query = forgeDeploymentQuerySchema.parse({
      limit: "100",
      offset: "200",
    });
    expect(query.limit).toBe(100);
    expect(query.offset).toBe(200);
  });

  it("refuses a page size that would return the whole table", () => {
    expect(() => forgeDeploymentQuerySchema.parse({ limit: "5000" })).toThrow();
  });

  it("refuses a sort key that is not a column it can order by", () => {
    expect(() =>
      forgeDeploymentQuerySchema.parse({ sort: "gitMessage" }),
    ).toThrow();
  });

  it("refuses a status outside the enum", () => {
    expect(() =>
      forgeDeploymentQuerySchema.parse({ status: ["ready", "exploded"] }),
    ).toThrow();
  });

  it("keeps every status a filter selects", () => {
    expect(
      forgeDeploymentQuerySchema.parse({ status: ["failed", "interrupted"] })
        .status,
    ).toEqual(["failed", "interrupted"]);
  });
});
