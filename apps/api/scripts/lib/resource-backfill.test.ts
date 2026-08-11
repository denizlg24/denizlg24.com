import { describe, expect, test } from "bun:test";

import {
  type BackfillInput,
  type ExistingResourceInput,
  type PlannedResource,
  planBackfill,
  summarizePlan,
} from "./resource-backfill";

const EPOCH = new Date("2026-01-01T00:00:00.000Z");

function project(
  slug: string,
  overrides: Partial<BackfillInput["projects"][number]> = {},
) {
  return {
    id: `project-${slug}`,
    meiliApiKey: null,
    meiliApiKeyUid: null,
    slug,
    ...overrides,
  };
}

function database(
  slug: string,
  type: "postgres" | "mongodb" | "redis",
  overrides: Partial<BackfillInput["databases"][number]> = {},
) {
  return {
    authTag: "tag",
    createdAt: EPOCH,
    dbName: `proj_${slug.replaceAll("-", "_")}`,
    encryptedPassword: "cipher",
    id: `db-${slug}-${type}`,
    iv: "iv",
    projectId: `project-${slug}`,
    type,
    username: `proj_${slug.replaceAll("-", "_")}`,
    ...overrides,
  };
}

function input(overrides: Partial<BackfillInput> = {}): BackfillInput {
  return {
    databases: [],
    existing: [],
    projects: [],
    s3Credentials: [],
    ...overrides,
  };
}

function asExisting(
  planned: PlannedResource,
  index: number,
): ExistingResourceInput {
  return {
    bucket: planned.bucket,
    connectedProjectIds: [planned.projectId],
    dbName: planned.dbName,
    id: `resource-${index}`,
    kind: planned.kind,
    meiliApiKeyUid: planned.meiliApiKeyUid,
    name: planned.name,
  };
}

describe("planBackfill: databases", () => {
  test("gives every project_databases row a resource connected to its project", () => {
    const plan = planBackfill(
      input({
        databases: [database("shortn-v2", "postgres")],
        projects: [project("shortn-v2")],
      }),
    );

    expect(plan.create).toHaveLength(1);
    const [created] = plan.create;
    expect(created).toMatchObject({
      dbName: "proj_shortn_v2",
      kind: "postgres",
      name: "shortn-v2",
      projectId: "project-shortn-v2",
      source: "project_databases",
    });
    // Everything pre-split served production and previews from one database.
    expect(created?.namespaceId).toBeNull();
  });

  test("one project with three kinds keeps the slug as the name for each", () => {
    const plan = planBackfill(
      input({
        databases: [
          database("api", "postgres"),
          database("api", "mongodb"),
          database("api", "redis"),
        ],
        projects: [project("api")],
      }),
    );

    expect(plan.create.map((row) => `${row.kind}/${row.name}`).sort()).toEqual([
      "mongodb/api",
      "postgres/api",
      "redis/api",
    ]);
  });

  test("carries the original createdAt so connection ordering stays stable", () => {
    const older = new Date("2025-05-01T00:00:00.000Z");
    const plan = planBackfill(
      input({
        databases: [database("api", "postgres", { createdAt: older })],
        projects: [project("api")],
      }),
    );

    expect(plan.create[0]?.createdAt).toEqual(older);
  });

  test("skips a row whose project is gone rather than throwing", () => {
    const plan = planBackfill(
      input({ databases: [database("ghost", "postgres")] }),
    );

    expect(plan.create).toHaveLength(0);
    expect(plan.skip).toEqual([
      {
        reason: "project row is missing",
        source: "project_databases",
        sourceId: "db-ghost-postgres",
      },
    ]);
  });
});

describe("planBackfill: s3", () => {
  test("creates one resource per project namespace, not per credential", () => {
    const plan = planBackfill(
      input({
        projects: [project("storage-user")],
        s3Credentials: [
          { id: "cred-1", projectId: "project-storage-user", revokedAt: null },
          { id: "cred-2", projectId: "project-storage-user", revokedAt: null },
        ],
      }),
    );

    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({
      bucket: "storage-user",
      kind: "s3",
      name: "storage-user",
      namespaceId: "project-storage-user",
    });
  });

  test("never represents the legacy NULL-project keypair", () => {
    const plan = planBackfill(
      input({
        projects: [project("api")],
        s3Credentials: [{ id: "legacy", projectId: null, revokedAt: null }],
      }),
    );

    expect(plan.create).toHaveLength(0);
  });

  test("ignores a project whose only credentials are revoked", () => {
    const plan = planBackfill(
      input({
        projects: [project("retired")],
        s3Credentials: [
          { id: "cred-1", projectId: "project-retired", revokedAt: EPOCH },
        ],
      }),
    );

    expect(plan.create).toHaveLength(0);
  });
});

describe("planBackfill: meilisearch", () => {
  test("moves the key off the project row", () => {
    const plan = planBackfill(
      input({
        projects: [
          project("search", {
            meiliApiKey: "key-abc",
            meiliApiKeyUid: "uid-1",
          }),
        ],
      }),
    );

    expect(plan.create[0]).toMatchObject({
      kind: "meilisearch",
      meiliApiKey: "key-abc",
      meiliApiKeyUid: "uid-1",
      name: "search",
      namespaceId: "project-search",
    });
  });

  test("needs both the key and its uid, because the uid is what revokes it", () => {
    const plan = planBackfill(
      input({
        projects: [
          project("half", { meiliApiKey: "key-abc", meiliApiKeyUid: null }),
        ],
      }),
    );

    expect(plan.create).toHaveLength(0);
  });
});

describe("planBackfill: idempotency", () => {
  test("a second run over the result of the first creates nothing", () => {
    const first = planBackfill(
      input({
        databases: [
          database("shortn-v2", "postgres"),
          database("shortn-v2", "redis"),
        ],
        projects: [
          project("shortn-v2", {
            meiliApiKey: "key-abc",
            meiliApiKeyUid: "uid-1",
          }),
        ],
        s3Credentials: [
          { id: "cred-1", projectId: "project-shortn-v2", revokedAt: null },
        ],
      }),
    );
    expect(first.create).toHaveLength(4);

    const second = planBackfill(
      input({
        databases: [
          database("shortn-v2", "postgres"),
          database("shortn-v2", "redis"),
        ],
        existing: first.create.map(asExisting),
        projects: [
          project("shortn-v2", {
            meiliApiKey: "key-abc",
            meiliApiKeyUid: "uid-1",
          }),
        ],
        s3Credentials: [
          { id: "cred-1", projectId: "project-shortn-v2", revokedAt: null },
        ],
      }),
    );

    expect(second.create).toHaveLength(0);
    expect(second.skip).toHaveLength(4);
  });

  test("a resource connected to a different project does not count as migrated", () => {
    const plan = planBackfill(
      input({
        databases: [database("api", "postgres")],
        existing: [
          {
            bucket: null,
            connectedProjectIds: ["project-other"],
            dbName: "proj_api",
            id: "resource-1",
            kind: "postgres",
            meiliApiKeyUid: null,
            name: "api",
          },
        ],
        projects: [project("api")],
      }),
    );

    expect(plan.create).toHaveLength(1);
    // The name is taken by the existing row, so the new one is suffixed rather
    // than colliding with the partial unique index.
    expect(plan.create[0]?.name).toBe("api-2");
  });
});

describe("summarizePlan", () => {
  test("breaks the count down by kind", () => {
    const plan = planBackfill(
      input({
        databases: [database("api", "postgres"), database("api", "mongodb")],
        projects: [project("api")],
      }),
    );

    expect(summarizePlan(plan)).toEqual({
      "create.mongodb": 1,
      "create.postgres": 1,
      create: 2,
      skip: 0,
    });
  });
});
