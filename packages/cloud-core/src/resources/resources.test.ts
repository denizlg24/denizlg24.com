import { describe, expect, test } from "bun:test";
import {
  connectionAppliesTo,
  type ResourceConnectionScope,
} from "@repo/schemas/cloud";

import type { ResourceRow } from "../db/schema";
import {
  databaseCredentials,
  toDatabaseMetadata,
  toResourceContract,
} from "./resources";

const CREATED_AT = new Date("2026-02-01T12:00:00.000Z");

function row(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    authTag: "tag",
    bucket: null,
    createdAt: CREATED_AT,
    dbName: "proj_api",
    deletedAt: null,
    encryptedPassword: "cipher",
    engine: "pi-cloud",
    id: "resource-1",
    iv: "iv",
    kind: "postgres",
    meiliApiKey: null,
    meiliApiKeyUid: null,
    name: "api",
    namespaceId: null,
    username: "proj_api",
    ...overrides,
  };
}

describe("connectionAppliesTo", () => {
  const unnamed = (scopes: ResourceConnectionScope) => ({
    scopes,
    environmentId: null,
  });
  const staging = { kind: "environment" as const, environmentId: "env-1" };

  test("`both` satisfies every slot", () => {
    expect(
      connectionAppliesTo(unnamed("both"), {
        kind: "production",
        environmentId: null,
      }),
    ).toBe(true);
    expect(
      connectionAppliesTo(unnamed("both"), {
        kind: "preview",
        environmentId: null,
      }),
    ).toBe(true);
    expect(connectionAppliesTo(unnamed("both"), staging)).toBe(true);
  });

  test("a production connection is invisible to a preview deployment", () => {
    expect(
      connectionAppliesTo(unnamed("production"), {
        kind: "preview",
        environmentId: null,
      }),
    ).toBe(false);
    expect(
      connectionAppliesTo(unnamed("preview"), {
        kind: "production",
        environmentId: null,
      }),
    ).toBe(false);
  });

  test("`preview` no longer covers a custom environment", () => {
    expect(connectionAppliesTo(unnamed("preview"), staging)).toBe(false);
    expect(connectionAppliesTo(unnamed("production"), staging)).toBe(false);
  });

  test("an environment connection matches only the environment it names", () => {
    const named = { scopes: "environment" as const, environmentId: "env-1" };
    expect(connectionAppliesTo(named, staging)).toBe(true);
    expect(
      connectionAppliesTo(named, {
        kind: "environment",
        environmentId: "env-2",
      }),
    ).toBe(false);
    expect(
      connectionAppliesTo(named, { kind: "preview", environmentId: null }),
    ).toBe(false);
    expect(
      connectionAppliesTo(named, { kind: "production", environmentId: null }),
    ).toBe(false);
  });
});

describe("databaseCredentials", () => {
  test("narrows a database row to the shape the old table carried", () => {
    expect(databaseCredentials(row())).toEqual({
      authTag: "tag",
      dbName: "proj_api",
      encryptedPassword: "cipher",
      iv: "iv",
      type: "postgres",
      username: "proj_api",
    });
  });

  test("refuses a non-database kind rather than handing back nulls", () => {
    expect(() =>
      databaseCredentials(
        row({
          bucket: "api",
          dbName: null,
          encryptedPassword: null,
          iv: null,
          authTag: null,
          kind: "s3",
          username: null,
        }),
      ),
    ).toThrow("carries no database credentials");
  });

  test("refuses a database row with a missing credential column", () => {
    expect(() => databaseCredentials(row({ encryptedPassword: null }))).toThrow(
      "carries no database credentials",
    );
  });
});

describe("toDatabaseMetadata", () => {
  test("reports the connected project, not an owner on the resource", () => {
    expect(toDatabaseMetadata(row(), "project-api")).toEqual({
      createdAt: CREATED_AT.toISOString(),
      dbName: "proj_api",
      id: "resource-1",
      projectId: "project-api",
      type: "postgres",
      username: "proj_api",
    });
  });

  test("only redis carries a key prefix", () => {
    const redis = toDatabaseMetadata(row({ kind: "redis" }), "project-api");
    expect(redis).toHaveProperty("keyPrefix", "proj_api:");
    expect(toDatabaseMetadata(row(), "project-api")).not.toHaveProperty(
      "keyPrefix",
    );
  });
});

describe("toResourceContract", () => {
  test("carries no credential of any kind", () => {
    const contract = toResourceContract(
      row({ bucket: "api", kind: "s3" }),
      3,
    ) as Record<string, unknown>;

    expect(contract.connectionCount).toBe(3);
    expect(contract.bucket).toBe("api");
    expect(Object.keys(contract)).not.toContain("encryptedPassword");
    expect(Object.keys(contract)).not.toContain("meiliApiKey");
  });
});
