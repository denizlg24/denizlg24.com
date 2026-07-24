import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRawClient, DockerClient } from "@repo/cloud-core";
import {
  mongoBackupTaskConfigSchema,
  postgresBackupTaskConfigSchema,
} from "@repo/schemas/cloud";
import { MongoClient } from "mongodb";

import { executeMongoBackup, executePostgresBackup } from "./backups";

const RUN_INFRA = process.env.RUN_CLOUD_INFRA_TESTS === "1";
const describeInfra = RUN_INFRA ? describe : describe.skip;
const DATABASE_URL =
  process.env.CLOUD_TEST_DATABASE_URL ??
  "postgresql://denizcloud:devpassword@localhost:5433/denizcloud";
const MONGO_URI =
  process.env.CLOUD_TEST_MONGODB_ADMIN_URI ??
  "mongodb://denizcloud:devpassword@localhost:27018/?authSource=admin&directConnection=true";
const DOCKER_PROXY_URL =
  process.env.CLOUD_TEST_DOCKER_HOST ?? "http://127.0.0.1:23750";

async function docker(
  arguments_: readonly string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const processHandle = Bun.spawn(["docker", ...arguments_], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function waitForCommand(
  arguments_: readonly string[],
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await docker(arguments_)).exitCode === 0) return;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for docker ${arguments_.join(" ")}`);
}

describeInfra("backup executors", () => {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const postgresTable = `ops_backup_${suffix}`;
  const mongoDatabase = `ops_backup_${suffix}`;
  const marker = `marker-${suffix}`;
  const postgres = createRawClient(DATABASE_URL, { max: 1 });
  const mongo = new MongoClient(MONGO_URI);
  const client = new DockerClient(DOCKER_PROXY_URL);
  let backupDirectory: string;

  beforeAll(async () => {
    backupDirectory = await mkdtemp(join(tmpdir(), "cloud-ops-backups-"));
    await client.ping();
    await postgres`
      CREATE TABLE ${postgres(postgresTable)} (
        marker text PRIMARY KEY
      )
    `;
    await postgres`
      INSERT INTO ${postgres(postgresTable)} (marker)
      VALUES (${marker})
    `;
    await mongo.connect();
    await mongo.db(mongoDatabase).collection("items").insertOne({ marker });
  });

  afterAll(async () => {
    await postgres`DROP TABLE IF EXISTS ${postgres(postgresTable)}`;
    await postgres.end();
    await mongo
      .db(mongoDatabase)
      .dropDatabase()
      .catch(() => undefined);
    await mongo.close();
    if (backupDirectory) {
      await rm(backupDirectory, { recursive: true, force: true });
    }
  });

  it("creates a restorable PostgreSQL artifact through the socket proxy", async () => {
    const result = await executePostgresBackup(
      postgresBackupTaskConfigSchema.parse({ retentionCount: 2 }),
      {
        backupDirectory,
        docker: client,
        postgresContainer: "postgres",
        mongoContainer: "mongodb",
      },
    );
    const artifact = result.metadata.backupPath;
    expect(artifact).toBeString();
    if (!artifact) throw new Error("Postgres backup path was not returned");

    const restoreContainer = `ops-pg-restore-${suffix}`;
    try {
      const started = await docker([
        "run",
        "--detach",
        "--name",
        restoreContainer,
        "--env",
        "POSTGRES_PASSWORD=restore-password",
        "--mount",
        `type=bind,source=${resolve(artifact)},target=/backup.sql.gz,readonly`,
        "postgres:16-alpine",
      ]);
      expect(started.exitCode).toBe(0);
      await waitForCommand([
        "exec",
        restoreContainer,
        "pg_isready",
        "-U",
        "postgres",
      ]);
      // The image briefly accepts connections on its initialization server
      // before restarting PostgreSQL for normal operation.
      await Bun.sleep(1_500);
      await waitForCommand([
        "exec",
        restoreContainer,
        "pg_isready",
        "-U",
        "postgres",
      ]);
      const restored = await docker([
        "exec",
        restoreContainer,
        "sh",
        "-c",
        "gzip -dc /backup.sql.gz | psql -v ON_ERROR_STOP=1 -U postgres -d postgres >/tmp/restore.log",
      ]);
      if (restored.exitCode !== 0) {
        throw new Error(`Postgres restore failed: ${restored.stderr}`);
      }
      const verified = await docker([
        "exec",
        restoreContainer,
        "psql",
        "-At",
        "-U",
        "postgres",
        "-d",
        "denizcloud",
        "-c",
        `SELECT marker FROM ${postgresTable}`,
      ]);
      expect(verified.stdout).toBe(marker);
    } finally {
      await docker(["rm", "--force", restoreContainer]);
    }
  }, 120_000);

  it("creates a restorable MongoDB artifact through the socket proxy", async () => {
    const result = await executeMongoBackup(
      mongoBackupTaskConfigSchema.parse({
        retentionCount: 2,
        databases: [mongoDatabase],
      }),
      {
        backupDirectory,
        docker: client,
        postgresContainer: "postgres",
        mongoContainer: "mongodb",
      },
    );
    const artifact = result.metadata.backupPath;
    expect(artifact).toBeString();
    if (!artifact) throw new Error("Mongo backup path was not returned");

    const restoreContainer = `ops-mongo-restore-${suffix}`;
    try {
      const started = await docker([
        "run",
        "--detach",
        "--name",
        restoreContainer,
        "--mount",
        `type=bind,source=${resolve(artifact)},target=/backup.archive.gz,readonly`,
        "mongo:8.2.11",
        "--bind_ip_all",
      ]);
      expect(started.exitCode).toBe(0);
      await waitForCommand([
        "exec",
        restoreContainer,
        "mongosh",
        "--quiet",
        "--eval",
        "quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)",
      ]);
      const restored = await docker([
        "exec",
        restoreContainer,
        "mongorestore",
        "--archive=/backup.archive.gz",
        "--gzip",
      ]);
      expect(restored.exitCode).toBe(0);
      const verified = await docker([
        "exec",
        restoreContainer,
        "mongosh",
        "--quiet",
        "--eval",
        `print(db.getSiblingDB(${JSON.stringify(mongoDatabase)}).items.findOne({marker:${JSON.stringify(marker)}}).marker)`,
      ]);
      expect(verified.stdout).toBe(marker);
    } finally {
      await docker(["rm", "--force", restoreContainer]);
    }
  }, 120_000);
});
