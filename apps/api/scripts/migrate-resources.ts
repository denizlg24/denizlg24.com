import {
  createDb,
  type Database,
  projectDatabases,
  projects,
  requiredEnv,
  resourceConnections,
  resources,
  s3Credentials,
} from "@repo/cloud-core";
import { isNull } from "drizzle-orm";

import {
  type BackfillInput,
  type BackfillPlan,
  planBackfill,
  summarizePlan,
} from "./lib/resource-backfill";
import {
  MARKERS,
  readMarker,
  requirePredecessors,
  runScript,
  ScriptError,
  writeMarker,
} from "./lib/runner";

/**
 * Moves `project_databases`, the project-scoped `s3_credentials` and
 * `projects.meili*` into `resources` + `resource_connections` (plan 016).
 *
 * **Run this before the API that reads connections is live.** Order is:
 *
 *   1. `apply-migrations --execute`  — additive; the running API ignores the
 *      two new tables entirely, so this is safe against the old release.
 *   2. `cutover:migrate-resources`   — dry run, then `--execute`. Also safe
 *      against the old release, for the same reason.
 *   3. deploy the API.
 *
 * Deploying first leaves every project with no connected resource, and a
 * deployment that binds `database.postgres.url` is then refused at enqueue by
 * `assertBindingsResolvable`. That failure is loud rather than silent — the
 * pre-flight check names the reference — but it is still every deployment.
 *
 * Nothing is destroyed. The source rows and columns are copied, not cleared,
 * so a rollback to the previous API keeps working against exactly the data it
 * wrote. Dropping `project_databases` and the two `meili_*` columns is a later
 * change, gated on this having run and the new binding path having resolved a
 * real deployment.
 *
 * The one thing it must not touch is the legacy NULL-project S3 keypair that
 * dependent projects still sign with.
 */

async function readInput(db: Database): Promise<BackfillInput> {
  const [projectRows, databaseRows, credentialRows, resourceRows, connections] =
    await Promise.all([
      db
        .select({
          id: projects.id,
          meiliApiKey: projects.meiliApiKey,
          meiliApiKeyUid: projects.meiliApiKeyUid,
          slug: projects.slug,
        })
        .from(projects),
      db.select().from(projectDatabases),
      db
        .select({
          id: s3Credentials.id,
          projectId: s3Credentials.projectId,
          revokedAt: s3Credentials.revokedAt,
        })
        .from(s3Credentials),
      db.select().from(resources).where(isNull(resources.deletedAt)),
      db
        .select({
          projectId: resourceConnections.projectId,
          resourceId: resourceConnections.resourceId,
        })
        .from(resourceConnections),
    ]);

  const connectedByResource = new Map<string, string[]>();
  for (const row of connections) {
    const existing = connectedByResource.get(row.resourceId) ?? [];
    existing.push(row.projectId);
    connectedByResource.set(row.resourceId, existing);
  }

  return {
    databases: databaseRows,
    existing: resourceRows.map((row) => ({
      bucket: row.bucket,
      connectedProjectIds: connectedByResource.get(row.id) ?? [],
      dbName: row.dbName,
      id: row.id,
      kind: row.kind,
      meiliApiKeyUid: row.meiliApiKeyUid,
      name: row.name,
    })),
    projects: projectRows,
    s3Credentials: credentialRows,
  };
}

/**
 * One transaction for the whole plan. A half-applied backfill would leave some
 * projects resolving bindings through connections and others through nothing at
 * all, which is the state that breaks deployments rather than merely delaying
 * them.
 */
async function apply(db: Database, plan: BackfillPlan): Promise<number> {
  if (plan.create.length === 0) return 0;
  return db.transaction(async (tx) => {
    for (const planned of plan.create) {
      const [row] = await tx
        .insert(resources)
        .values({
          authTag: planned.authTag,
          bucket: planned.bucket,
          dbName: planned.dbName,
          encryptedPassword: planned.encryptedPassword,
          iv: planned.iv,
          kind: planned.kind,
          meiliApiKey: planned.meiliApiKey,
          meiliApiKeyUid: planned.meiliApiKeyUid,
          name: planned.name,
          namespaceId: planned.namespaceId,
          username: planned.username,
          ...(planned.createdAt ? { createdAt: planned.createdAt } : {}),
        })
        .returning({ id: resources.id });
      if (!row) {
        throw new ScriptError(
          `Failed to insert ${planned.kind} resource ${planned.name}`,
        );
      }
      await tx.insert(resourceConnections).values({
        // Everything pre-split had one datastore serving production and
        // previews alike. Narrowing a scope is a deliberate later act.
        projectId: planned.projectId,
        resourceId: row.id,
        scopes: "both",
      });
    }
    return plan.create.length;
  });
}

/**
 * Every database that had a binding before must still have one. This is the
 * check that catches the failure the plan calls out: dropping the old
 * constraint without the backfill leaves those databases unreachable.
 */
async function assertEveryDatabaseConnected(db: Database): Promise<void> {
  const input = await readInput(db);
  const orphans = input.databases.filter(
    (row) =>
      !input.existing.some(
        (candidate) =>
          candidate.kind === row.type &&
          candidate.dbName === row.dbName &&
          candidate.connectedProjectIds.includes(row.projectId),
      ),
  );
  if (orphans.length > 0) {
    throw new ScriptError(
      `${orphans.length} project_databases rows have no connected resource: ${orphans
        .map((row) => `${row.type}/${row.dbName}`)
        .join(", ")}`,
    );
  }
}

await runScript("migrate-resources", async (flags, log) => {
  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
  try {
    const plan = planBackfill(await readInput(db));
    const counts = summarizePlan(plan);
    await log.event("planned", counts);

    if ((await readMarker(db, MARKERS.resources)) !== null) {
      // Re-running after completion still verifies, because the marker proves
      // the script ran and not that the data is still sound.
      await assertEveryDatabaseConnected(db);
      return { alreadyComplete: true, ...counts };
    }

    if (flags.dryRun) {
      for (const planned of plan.create) {
        await log.event("would-create", {
          kind: planned.kind,
          name: planned.name,
          projectId: planned.projectId,
          source: planned.source,
        });
      }
      for (const skipped of plan.skip) {
        await log.event("would-skip", { ...skipped });
      }
      return { alreadyComplete: false, ...counts };
    }

    await requirePredecessors(db, MARKERS.resources);
    const created = await apply(db, plan);
    await assertEveryDatabaseConnected(db);
    await writeMarker(db, MARKERS.resources, String(created));
    await log.event("committed", { created });

    return { alreadyComplete: false, created, ...counts };
  } finally {
    await db.$client.end({ timeout: 5 });
  }
});
