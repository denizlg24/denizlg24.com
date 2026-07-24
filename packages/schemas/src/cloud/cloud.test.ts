import { describe, expect, it } from "bun:test";

import {
  API_KEY_SCOPES,
  apiErrorResponseSchema,
  createCollectionInputSchema,
  createdApiKeySchema,
  folderContentsResponseSchema,
  metricsQuerySchema,
  mongoBackupTaskConfigSchema,
  paginatedResponseSchema,
  safeApiKeySchema,
  safeProjectSchema,
  safeUserSchema,
  shareLinkTokenSchema,
  taskTypeSchema,
} from "./index";

const NOW = "2026-07-23T12:00:00.000Z";

describe("cloud API contracts", () => {
  it("preserves the scoped API key vocabulary and reveal-once response", () => {
    expect(API_KEY_SCOPES).toEqual([
      "storage:read",
      "storage:write",
      "storage:delete",
      "storage:manage",
      "search:read",
      "search:write",
      "search:manage",
    ]);

    expect(
      createdApiKeySchema.parse({
        id: "5aa9f5db-9125-4db9-b90e-164705630e6e",
        key: "secret-only-returned-once",
        prefix: "secret-o",
      }),
    ).toEqual({
      id: "5aa9f5db-9125-4db9-b90e-164705630e6e",
      key: "secret-only-returned-once",
      prefix: "secret-o",
    });
  });

  it("keeps password hashes and API key hashes out of safe payloads", () => {
    const safeUser = safeUserSchema.parse({
      id: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
      username: "deniz",
      email: null,
      passwordHash: "must-not-pass",
      role: "superuser",
      status: "active",
      totpEnabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(safeUser).not.toHaveProperty("passwordHash");

    const safeKey = safeApiKeySchema.parse({
      id: "a37d5cef-bdcc-48b7-97a8-45b85c3ef9bb",
      userId: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
      projectId: "5211d914-5dd3-49e7-b388-488c06f8120c",
      name: "storage",
      keyHash: "must-not-pass",
      keyPrefix: "abcdefgh",
      scopes: ["storage:read"],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: NOW,
    });
    expect(safeKey).not.toHaveProperty("keyHash");
  });

  it("preserves project and collection source wire shapes", () => {
    expect(
      safeProjectSchema.parse({
        id: "5211d914-5dd3-49e7-b388-488c06f8120c",
        name: "Project",
        slug: "project",
        description: null,
        ownerId: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
        storageFolderId: null,
        meiliApiKeyUid: null,
        meiliApiKey: null,
        createdAt: NOW,
        updatedAt: NOW,
      }).slug,
    ).toBe("project");

    expect(
      createCollectionInputSchema.safeParse({
        name: "users",
        sourceType: "postgres",
        pgDatabase: "app",
        pgSchema: "public",
        pgTable: "users",
        pgIdColumn: "id",
      }).success,
    ).toBe(true);

    expect(
      createCollectionInputSchema.safeParse({
        name: "users",
        sourceType: "mongodb",
        mongoDatabase: "app",
      }).success,
    ).toBe(false);

    expect(
      createCollectionInputSchema.safeParse({
        name: "Invalid_Name",
        sourceType: "mongodb",
        mongoDatabase: "app",
        mongoCollection: "users",
      }).success,
    ).toBe(false);
  });

  it("preserves generic error, pagination, storage, share, and task contracts", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: { code: "NOT_FOUND", message: "Not found" },
      }),
    ).toEqual({
      error: { code: "NOT_FOUND", message: "Not found" },
    });

    const pageSchema = paginatedResponseSchema(safeUserSchema);
    expect(
      pageSchema.parse({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      }).pagination.total,
    ).toBe(0);

    expect(
      folderContentsResponseSchema.safeParse({
        data: {
          folder: {
            id: "5f3a89bd-81a4-4640-b468-d387635a8835",
            name: "root",
            path: "/root",
            parentId: null,
          },
          subfolders: [],
          files: [],
        },
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      }).success,
    ).toBe(true);

    expect(shareLinkTokenSchema.parse({ token: "opaque-token" }).token).toBe(
      "opaque-token",
    );
    expect(taskTypeSchema.parse("backup_all")).toBe("backup_all");
  });

  it("bounds operations queries and backup filters", () => {
    const query = {
      series: ["host:cpu.usage_percent"],
      from: "2026-07-22T00:00:00.000Z",
      to: "2026-07-24T00:00:00.000Z",
      step: 30,
    };
    expect(metricsQuerySchema.safeParse(query).success).toBe(true);
    expect(
      metricsQuerySchema.safeParse({
        ...query,
        from: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      metricsQuerySchema.safeParse({
        ...query,
        series: Array.from(
          { length: 50 },
          (_, index) => `host:metric.${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      mongoBackupTaskConfigSchema.safeParse({
        retentionCount: 7,
        databases: ["one", "two"],
      }).success,
    ).toBe(false);
  });
});
