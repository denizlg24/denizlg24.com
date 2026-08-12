import { describe, expect, it } from "bun:test";

import { DEFAULT_STATUSES, resolveDeploymentQuery } from "./deployment-query";

function resolve(search: string) {
  return resolveDeploymentQuery(new URLSearchParams(search));
}

describe("resolveDeploymentQuery", () => {
  it("applies the default statuses when the URL says nothing about status", () => {
    const { query, statusFromUrl } = resolve("");
    expect(query.status).toEqual(DEFAULT_STATUSES);
    // The default is a starting view, not a filter the owner set.
    expect(statusFromUrl).toBe(false);
  });

  it("takes the statuses the URL names", () => {
    const { query, statusFromUrl } = resolve("status=ready&status=superseded");
    expect(query.status).toEqual(["ready", "superseded"]);
    expect(statusFromUrl).toBe(true);
  });

  it("keeps the default statuses when another parameter fails to parse", () => {
    // Falling back to the schema's own defaults gives `status: []`, which the
    // query reads as "every status" — so a malformed size answered with the
    // superseded rows the default view exists to hide.
    const { query, statusFromUrl } = resolve("size=nonsense");
    expect(query.status).toEqual(DEFAULT_STATUSES);
    expect(query.limit).toBe(50);
    expect(statusFromUrl).toBe(false);
  });

  it("reports no status filter when the status itself fails to parse", () => {
    // The raw parameter is set, but nothing from the URL survived. Reading it
    // anyway labels the default view "matched" and offers a clear that clears
    // nothing.
    const { query, statusFromUrl } = resolve("status=not-a-status");
    expect(query.status).toEqual(DEFAULT_STATUSES);
    expect(statusFromUrl).toBe(false);
  });

  it("widens a bare date to the whole day it names", () => {
    const { query } = resolve("since=2026-08-01&until=2026-08-01");
    expect(new Date(String(query.until)).getTime()).toBeGreaterThan(
      new Date(String(query.since)).getTime(),
    );
  });

  it("ignores an unparseable date rather than failing the whole query", () => {
    const { query } = resolve("since=yesterday&project=forge");
    expect(query.since).toBeNull();
    expect(query.project).toBe("forge");
  });
});
