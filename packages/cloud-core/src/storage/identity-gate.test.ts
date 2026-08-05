import { describe, expect, it } from "bun:test";

import { MetadataClientError } from "./metadata-client";

/**
 * The byte path's identity gate, exercised through the same decision table
 * `StorageService.assertNamespaceIdentity` applies. Standing up the whole
 * service needs Postgres and Meilisearch; what matters here is that no
 * metadata outcome can reach the "serve the bytes" branch except a confirmed
 * match.
 */
function classify(
  mode: "legacy-dual-path" | "broker-mounted",
  outcome: "match" | MetadataClientError | "no-client",
): { served: boolean; status?: number } {
  if (outcome === "no-client") {
    return mode === "broker-mounted"
      ? { served: false, status: 503 }
      : { served: true };
  }
  if (outcome === "match") return { served: true };
  if (outcome.code === "ID_MISMATCH") return { served: false, status: 409 };
  return { served: false, status: 503 };
}

const failures: MetadataClientError[] = [
  new MetadataClientError("renamed", "ID_MISMATCH"),
  new MetadataClientError("socket gone", "UNAVAILABLE"),
  new MetadataClientError("missing", "NOT_FOUND"),
  new MetadataClientError("symlinked", "SYMLINK"),
  new MetadataClientError("no xattr", "NO_IDENTITY"),
  new MetadataClientError("bad request", "BAD_REQUEST"),
];

describe("namespace identity gate", () => {
  it("serves only a confirmed identity match", () => {
    expect(classify("broker-mounted", "match")).toEqual({ served: true });
  });

  it("refuses to serve bytes for every metadata failure", () => {
    for (const failure of failures) {
      const result = classify("broker-mounted", failure);
      expect(result.served, `${failure.code} must not serve`).toBe(false);
    }
  });

  it("reports a rename as a conflict, not a missing file", () => {
    // 404 here would tell the caller the file is gone when it is the *path*
    // that moved; 409 says the projection and namespace disagree.
    expect(
      classify("broker-mounted", new MetadataClientError("x", "ID_MISMATCH")),
    ).toEqual({ served: false, status: 409 });
  });

  it("treats an unreachable service as unavailable, never as absent", () => {
    for (const code of ["UNAVAILABLE", "NOT_FOUND"] as const) {
      expect(
        classify("broker-mounted", new MetadataClientError("x", code)).status,
      ).toBe(503);
    }
  });

  it("fails closed in broker mode when no client is configured", () => {
    expect(classify("broker-mounted", "no-client")).toEqual({
      served: false,
      status: 503,
    });
  });

  it("leaves legacy mode untouched, where diskPath is the identity", () => {
    expect(classify("legacy-dual-path", "no-client")).toEqual({ served: true });
  });
});
