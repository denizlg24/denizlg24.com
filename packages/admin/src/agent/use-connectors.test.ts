import { describe, expect, test } from "bun:test";
import type { Connector } from "@repo/schemas";
import { sortConnectors } from "./use-connectors";

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "connector-1",
    slug: "other",
    name: "Other",
    url: "https://example.com/mcp",
    auth: "none",
    approval: "reads-auto",
    enabled: true,
    disabledTools: [],
    status: "ready",
    statusDetail: null,
    toolCount: 2,
    builtIn: false,
    hasSecret: false,
    lastCheckedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sortConnectors", () => {
  test("coalesces duplicate slugs and keeps the healthy built-in row", () => {
    const result = sortConnectors([
      connector({
        id: "stale",
        slug: "denizlg24",
        name: "denizlg24",
        status: "error",
        toolCount: 0,
      }),
      connector({
        id: "healthy",
        slug: "denizlg24",
        name: "denizlg24",
        builtIn: true,
        toolCount: 239,
      }),
      connector(),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["healthy", "connector-1"]);
  });
});
