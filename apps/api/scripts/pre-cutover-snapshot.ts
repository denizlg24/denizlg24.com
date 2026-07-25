import { constants } from "node:fs";
import { access, mkdir, stat, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  computeChecksum,
  createRawClient,
  DockerClient,
  optionalEnv,
  requiredEnv,
} from "@repo/cloud-core";

import {
  executeMongoBackup,
  executePostgresBackup,
} from "../src/ops/executors/backups";
import { runScript, ScriptError } from "./lib/runner";

/**
 * Captures the rollback asset for the cutover: a timestamped directory holding
 * a Postgres dump, a MongoDB archive, the Redis ACL file and the drizzle
 * migration state, plus a manifest with a SHA-256 per artifact.
 *
 * It reuses the ops-plane backup executors (006) rather than shelling out to
 * pg_dump directly, so the cutover runs the same proven code path as the
 * nightly backups. Retention is inert here because each snapshot writes into
 * its own directory.
 *
 * Every artifact is verified after writing — size floor, gzip integrity and
 * checksum. An unverified dump is worse than no dump: it produces false
 * confidence at exactly the moment rollback matters.
 */

const RETENTION_DISABLED = 10_000;
const MIN_ARTIFACT_BYTES = 512;
/** Conservative: the gzipped dump is far smaller than the live data size. */
const FREE_SPACE_SAFETY_FACTOR = 1.5;

interface Artifact {
  bytes: number;
  name: string;
  path: string;
  sha256: string;
}

interface Manifest {
  artifacts: Artifact[];
  createdAt: string;
  drizzleMigrations: string[];
  snapshotDirectory: string;
}

function snapshotStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
}

async function assertGzipIntact(path: string): Promise<void> {
  const process_ = Bun.spawn(["gzip", "-t", path], {
    stderr: "pipe",
    stdout: "ignore",
  });
  const exitCode = await process_.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process_.stderr).text();
    throw new ScriptError(
      `Snapshot artifact ${path} failed gzip integrity check: ${stderr.trim()}`,
    );
  }
}

async function verifyArtifact(
  name: string,
  path: string,
  minimumBytes: number,
): Promise<Artifact> {
  const stats = await stat(path).catch(() => null);
  if (!stats) {
    throw new ScriptError(`Snapshot artifact ${name} was not written: ${path}`);
  }
  if (stats.size < minimumBytes) {
    throw new ScriptError(
      `Snapshot artifact ${name} is only ${stats.size} bytes — treat as a failed dump`,
    );
  }
  if (path.endsWith(".gz")) await assertGzipIntact(path);
  return {
    bytes: stats.size,
    name,
    path,
    sha256: await computeChecksum(path),
  };
}

/** Upper bound on dump size: total live Postgres bytes across all databases. */
async function postgresLiveBytes(): Promise<number> {
  const client = createRawClient(requiredEnv("DATABASE_URL"));
  try {
    const rows = await client<{ total: string }[]>`
      SELECT COALESCE(SUM(pg_database_size(datname)), 0)::text AS total
      FROM pg_database
      WHERE datistemplate = false
    `;
    return Number(rows[0]?.total ?? 0);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function freeBytes(path: string): Promise<number> {
  const stats = await statfs(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * `DRIZZLE_MIGRATIONS_DIR` lets the script run from a bundle or any working
 * directory — on the Pi it is deployed next to the migration SQL rather than
 * inside the monorepo tree.
 */
function drizzleDirectory(): string {
  return process.env.DRIZZLE_MIGRATIONS_DIR
    ? resolve(process.env.DRIZZLE_MIGRATIONS_DIR)
    : resolve(import.meta.dir, "../../../packages/cloud-core/drizzle");
}

async function drizzleMigrationList(): Promise<string[]> {
  const directory = drizzleDirectory();
  const glob = new Bun.Glob("*.sql");
  const names: string[] = [];
  for await (const name of glob.scan({ cwd: directory })) names.push(name);
  return names.sort();
}

async function archiveDrizzleState(snapshotDirectory: string): Promise<string> {
  const source = drizzleDirectory();
  const path = join(snapshotDirectory, "drizzle-state.tar.gz");
  const process_ = Bun.spawn(
    ["tar", "-czf", path, "-C", resolve(source, ".."), "drizzle"],
    { stderr: "pipe", stdout: "ignore" },
  );
  if ((await process_.exited) !== 0) {
    const stderr = await new Response(process_.stderr).text();
    throw new ScriptError(`Failed to archive drizzle state: ${stderr.trim()}`);
  }
  return path;
}

async function captureRedisAcl(
  docker: DockerClient,
  snapshotDirectory: string,
): Promise<string> {
  const container = optionalEnv("REDIS_CONTAINER", "redis");
  const aclFile = optionalEnv("REDIS_ACL_FILE", "/data/users.acl");
  const path = join(snapshotDirectory, "redis-users.acl");
  const result = await docker.execToFile(
    container,
    ["sh", "-c", `cat "$1"`, "sh", aclFile],
    path,
  );
  if (result.exitCode !== 0) {
    throw new ScriptError(
      `Failed to read the Redis ACL file (${result.exitCode}): ${result.stderr}`,
    );
  }
  return path;
}

await runScript("pre-cutover-snapshot", async (flags, log) => {
  const backupDirectory = resolve(optionalEnv("BACKUP_DIR", "/backups"));
  const postgresContainer = optionalEnv("POSTGRES_CONTAINER", "postgres");
  const mongoContainer = optionalEnv("MONGODB_CONTAINER", "mongodb");

  await access(backupDirectory, constants.W_OK).catch(() => {
    throw new ScriptError(`BACKUP_DIR is not writable: ${backupDirectory}`);
  });

  const docker = new DockerClient();
  await docker.ping().catch((error: unknown) => {
    throw new ScriptError(
      `Docker is unreachable (DOCKER_HOST=${process.env.DOCKER_HOST ?? "default"}): ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  for (const reference of [postgresContainer, mongoContainer]) {
    await docker.resolveContainer(reference).catch(() => {
      throw new ScriptError(`Container not found: ${reference}`);
    });
  }

  const liveBytes = await postgresLiveBytes();
  const available = await freeBytes(backupDirectory);
  const required = Math.ceil(liveBytes * FREE_SPACE_SAFETY_FACTOR);
  if (available < required) {
    throw new ScriptError(
      `Insufficient space in ${backupDirectory}: ${available} bytes free, ~${required} needed. A truncated snapshot is not a rollback asset.`,
    );
  }

  const snapshotDirectory = join(backupDirectory, `cutover-${snapshotStamp()}`);
  const migrations = await drizzleMigrationList();

  await log.event("preflight-passed", {
    available,
    migrations: migrations.length,
    required,
    snapshotDirectory,
  });

  if (flags.dryRun) {
    return {
      backupDirectory,
      drizzleMigrations: migrations.length,
      freeBytes: available,
      requiredBytes: required,
      wouldWriteTo: snapshotDirectory,
    };
  }

  if (await stat(snapshotDirectory).catch(() => null)) {
    throw new ScriptError(
      `Snapshot directory already exists: ${snapshotDirectory}`,
    );
  }
  await mkdir(snapshotDirectory, { mode: 0o700, recursive: true });

  const executorOptions = {
    backupDirectory: snapshotDirectory,
    docker,
    mongoContainer,
    postgresContainer,
  };

  const postgres = await executePostgresBackup(
    { retentionCount: RETENTION_DISABLED },
    executorOptions,
  );
  await log.event("postgres-dumped", postgres.metadata);

  const mongo = await executeMongoBackup(
    { retentionCount: RETENTION_DISABLED },
    executorOptions,
  );
  await log.event("mongo-dumped", mongo.metadata);

  const redisAclPath = await captureRedisAcl(docker, snapshotDirectory);
  const drizzlePath = await archiveDrizzleState(snapshotDirectory);

  const artifacts: Artifact[] = [];
  // The ACL file is legitimately tiny (a handful of user lines), so it only has
  // to be non-empty; the dumps carry the real size floor.
  for (const [name, path, minimumBytes] of [
    ["postgres", postgres.metadata.backupPath, MIN_ARTIFACT_BYTES],
    ["mongodb", mongo.metadata.backupPath, MIN_ARTIFACT_BYTES],
    ["redis-acl", redisAclPath, 1],
    ["drizzle-state", drizzlePath, MIN_ARTIFACT_BYTES],
  ] as const) {
    if (typeof path !== "string") {
      throw new ScriptError(`Executor did not report a path for ${name}`);
    }
    artifacts.push(await verifyArtifact(name, path, minimumBytes));
  }

  const manifest: Manifest = {
    artifacts,
    createdAt: new Date().toISOString(),
    drizzleMigrations: migrations,
    snapshotDirectory,
  };
  await writeFile(
    join(snapshotDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await log.event("verified", { artifacts: artifacts.length });

  return {
    artifacts: artifacts.map(({ bytes, name }) => ({ bytes, name })),
    snapshotDirectory,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
  };
});
