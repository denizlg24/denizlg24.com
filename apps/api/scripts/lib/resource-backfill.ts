import type { ResourceKind } from "@repo/schemas/cloud";

/**
 * The planning half of `migrate-resources`, kept free of database access so the
 * decisions can be tested directly. The script reads rows, calls `planBackfill`
 * and either prints the plan or applies it; nothing here writes.
 */

export interface ProjectInput {
  id: string;
  slug: string;
  meiliApiKey: string | null;
  meiliApiKeyUid: string | null;
}

export interface ProjectDatabaseInput {
  id: string;
  projectId: string;
  type: "postgres" | "mongodb" | "redis";
  dbName: string;
  username: string;
  encryptedPassword: string;
  iv: string;
  authTag: string;
  createdAt: Date;
}

export interface S3CredentialInput {
  id: string;
  projectId: string | null;
  revokedAt: Date | null;
}

/** A live `resources` row plus the projects it is already connected to. */
export interface ExistingResourceInput {
  id: string;
  kind: ResourceKind;
  name: string;
  dbName: string | null;
  bucket: string | null;
  meiliApiKeyUid: string | null;
  connectedProjectIds: readonly string[];
}

export type BackfillSource =
  | "project_databases"
  | "projects.meili"
  | "s3_credentials";

export interface PlannedResource {
  source: BackfillSource;
  sourceId: string;
  projectId: string;
  kind: ResourceKind;
  name: string;
  namespaceId: string | null;
  dbName: string | null;
  username: string | null;
  encryptedPassword: string | null;
  iv: string | null;
  authTag: string | null;
  bucket: string | null;
  meiliApiKeyUid: string | null;
  meiliApiKey: string | null;
  createdAt: Date | null;
}

export interface SkippedRow {
  source: BackfillSource;
  sourceId: string;
  reason: string;
}

export interface BackfillPlan {
  create: PlannedResource[];
  skip: SkippedRow[];
}

export interface BackfillInput {
  projects: readonly ProjectInput[];
  databases: readonly ProjectDatabaseInput[];
  s3Credentials: readonly S3CredentialInput[];
  existing: readonly ExistingResourceInput[];
}

class NameAllocator {
  private readonly taken = new Map<ResourceKind, Set<string>>();

  constructor(existing: readonly ExistingResourceInput[]) {
    for (const row of existing) {
      this.reserve(row.kind, row.name);
    }
  }

  private reserve(kind: ResourceKind, name: string): void {
    const names = this.taken.get(kind) ?? new Set<string>();
    names.add(name);
    this.taken.set(kind, names);
  }

  /** Mirrors `availableResourceName`, over the plan as well as the table. */
  allocate(kind: ResourceKind, base: string): string {
    const names = this.taken.get(kind) ?? new Set<string>();
    let candidate = base;
    for (let suffix = 2; names.has(candidate); suffix += 1) {
      candidate = `${base}-${suffix}`;
    }
    this.reserve(kind, candidate);
    return candidate;
  }
}

/**
 * Re-running must be free. A row is already migrated when a live resource of
 * the same kind is connected to the same project and carries the same identity
 * — the database name, the bucket, or the Meilisearch key uid. Matching on
 * identity rather than on a marker means a partially applied run resumes
 * exactly where it stopped.
 */
function alreadyMigrated(
  existing: readonly ExistingResourceInput[],
  projectId: string,
  kind: ResourceKind,
  identity: (row: ExistingResourceInput) => boolean,
): boolean {
  return existing.some(
    (row) =>
      row.kind === kind &&
      row.connectedProjectIds.includes(projectId) &&
      identity(row),
  );
}

export function planBackfill(input: BackfillInput): BackfillPlan {
  const create: PlannedResource[] = [];
  const skip: SkippedRow[] = [];
  const names = new NameAllocator(input.existing);
  const projectsById = new Map(input.projects.map((row) => [row.id, row]));

  const blank = {
    authTag: null,
    bucket: null,
    createdAt: null,
    dbName: null,
    encryptedPassword: null,
    iv: null,
    meiliApiKey: null,
    meiliApiKeyUid: null,
    namespaceId: null,
    username: null,
  } satisfies Omit<
    PlannedResource,
    "kind" | "name" | "projectId" | "source" | "sourceId"
  >;

  for (const row of [...input.databases].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  )) {
    const project = projectsById.get(row.projectId);
    if (!project) {
      skip.push({
        reason: "project row is missing",
        source: "project_databases",
        sourceId: row.id,
      });
      continue;
    }
    if (
      alreadyMigrated(
        input.existing,
        row.projectId,
        row.type,
        (candidate) => candidate.dbName === row.dbName,
      )
    ) {
      skip.push({
        reason: "already connected",
        source: "project_databases",
        sourceId: row.id,
      });
      continue;
    }
    create.push({
      ...blank,
      authTag: row.authTag,
      // Preserved so the resource keeps the age of the database it describes;
      // it is also the tiebreak that orders competing connections.
      createdAt: row.createdAt,
      dbName: row.dbName,
      encryptedPassword: row.encryptedPassword,
      iv: row.iv,
      kind: row.type,
      name: names.allocate(row.type, project.slug),
      projectId: row.projectId,
      source: "project_databases",
      sourceId: row.id,
      username: row.username,
    });
  }

  /**
   * One `s3` resource per project namespace, not per credential. The bucket is
   * a directory named exactly the project slug, so several credentials — the
   * owner's plus one per deployment — all address the same one. The legacy
   * NULL-project pair is not represented here at all: it is on the
   * cannot-change list and nothing about it moves.
   */
  const storageProjects = new Set(
    input.s3Credentials.flatMap((row) =>
      row.projectId !== null && row.revokedAt === null ? [row.projectId] : [],
    ),
  );
  for (const projectId of [...storageProjects].sort()) {
    const project = projectsById.get(projectId);
    if (!project) {
      skip.push({
        reason: "project row is missing",
        source: "s3_credentials",
        sourceId: projectId,
      });
      continue;
    }
    if (
      alreadyMigrated(
        input.existing,
        projectId,
        "s3",
        (candidate) => candidate.bucket === project.slug,
      )
    ) {
      skip.push({
        reason: "already connected",
        source: "s3_credentials",
        sourceId: projectId,
      });
      continue;
    }
    create.push({
      ...blank,
      bucket: project.slug,
      kind: "s3",
      name: names.allocate("s3", project.slug),
      namespaceId: projectId,
      projectId,
      source: "s3_credentials",
      sourceId: projectId,
    });
  }

  for (const project of [...input.projects].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  )) {
    if (!project.meiliApiKey || !project.meiliApiKeyUid) continue;
    if (
      alreadyMigrated(
        input.existing,
        project.id,
        "meilisearch",
        (candidate) => candidate.meiliApiKeyUid === project.meiliApiKeyUid,
      )
    ) {
      skip.push({
        reason: "already connected",
        source: "projects.meili",
        sourceId: project.id,
      });
      continue;
    }
    create.push({
      ...blank,
      kind: "meilisearch",
      meiliApiKey: project.meiliApiKey,
      meiliApiKeyUid: project.meiliApiKeyUid,
      name: names.allocate("meilisearch", project.slug),
      namespaceId: project.id,
      projectId: project.id,
      source: "projects.meili",
      sourceId: project.id,
    });
  }

  return { create, skip };
}

export function summarizePlan(plan: BackfillPlan): Record<string, number> {
  const counts: Record<string, number> = {
    create: plan.create.length,
    skip: plan.skip.length,
  };
  for (const row of plan.create) {
    const key = `create.${row.kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
