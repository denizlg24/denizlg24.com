import { describe, expect, test } from "bun:test";

import type { Database } from "../db";
import { identifierForSlug } from "../projects/provisioning";
import { provisionResource, type ResourceProvisionDeps } from "./provision";

/**
 * Every guard below has to fire before anything reaches an engine or the
 * database, so the stubs throw rather than returning a value: a test that
 * passes because a query returned `undefined` would not distinguish "refused"
 * from "provisioned against nothing".
 */
const UNREACHABLE_DB = new Proxy(
  {},
  {
    get() {
      throw new Error("provisionResource touched the database");
    },
  },
) as unknown as Database;

const UNREACHABLE_DEPS: ResourceProvisionDeps = {
  encryptionSecret: "secret",
  registry: new Map(),
  search: {
    createKey() {
      throw new Error("provisionResource issued a search key");
    },
    deleteKey() {
      throw new Error("provisionResource revoked a search key");
    },
  },
};

describe("provisionResource", () => {
  test("refuses an s3 resource with no project to name its bucket", async () => {
    await expect(
      provisionResource(UNREACHABLE_DB, UNREACHABLE_DEPS, { kind: "s3" }),
    ).rejects.toThrow("needs a project");
  });

  test("refuses a meilisearch resource with no project", async () => {
    await expect(
      provisionResource(UNREACHABLE_DB, UNREACHABLE_DEPS, {
        kind: "meilisearch",
      }),
    ).rejects.toThrow("needs a project");
  });

  test("refuses a standalone database with no name to derive one from", async () => {
    await expect(
      provisionResource(UNREACHABLE_DB, UNREACHABLE_DEPS, { kind: "postgres" }),
    ).rejects.toThrow("needs a name");
  });
});

/**
 * The database and role a resource gets are derived from its name, which is
 * unique per kind. Deriving them from a project slug is what would give two
 * postgres resources on one project the same database — the failure the
 * resource model exists to make impossible.
 */
describe("identifierForSlug", () => {
  test("two resources on one project resolve to two databases", () => {
    expect(identifierForSlug("shortn-v2")).toBe("proj_shortn_v2");
    expect(identifierForSlug("shortn-v2-2")).toBe("proj_shortn_v2_2");
  });

  test("reproduces the identifier every backfilled row already carries", () => {
    expect(identifierForSlug("alojamento-ideal-dev")).toBe(
      "proj_alojamento_ideal_dev",
    );
  });

  test("stays inside the 63-byte identifier limit", () => {
    expect(identifierForSlug("a".repeat(120))).toHaveLength(63);
  });
});
