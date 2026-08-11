import { describe, expect, test } from "bun:test";
import { connectionAppliesTo } from "@repo/schemas/cloud";

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
  test("`both` satisfies either side", () => {
    expect(connectionAppliesTo("both", "production")).toBe(true);
    expect(connectionAppliesTo("both", "preview")).toBe(true);
  });

  test("a production connection is invisible to a preview deployment", () => {
    expect(connectionAppliesTo("production", "preview")).toBe(false);
    expect(connectionAppliesTo("preview", "production")).toBe(false);
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
