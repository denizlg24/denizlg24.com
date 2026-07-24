import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DockerClient } from "@repo/cloud-core";
import type {
  FilesBackupTaskConfig,
  MongoBackupTaskConfig,
  PostgresBackupTaskConfig,
  TaskRunMetadata,
} from "@repo/schemas/cloud";

import {
  backupTimestamp,
  enforceRetention,
  ensureDirectory,
  fileSize,
  runProcess,
} from "./utils";

export interface BackupExecutorOptions {
  backupDirectory: string;
  docker: DockerClient;
  postgresContainer: string;
  mongoContainer: string;
}

export interface ExecutorResult {
  output: string;
  metadata: TaskRunMetadata;
}

function backupSummary(
  label: string,
  path: string,
  sizeBytes: number,
  durationMs: number,
  deleted: readonly string[],
): string {
  const lines = [
    `${label} backup completed: ${path}`,
    `Size: ${(sizeBytes / 1_048_576).toFixed(2)} MiB`,
    `Duration: ${(durationMs / 1_000).toFixed(1)}s`,
  ];
  if (deleted.length > 0) {
    lines.push(`Retention cleanup: removed ${deleted.length} old backup(s)`);
  }
  return lines.join("\n");
}

export async function executePostgresBackup(
  config: PostgresBackupTaskConfig,
  options: BackupExecutorOptions,
): Promise<ExecutorResult> {
  const startedAt = Date.now();
  const directory = join(options.backupDirectory, "postgres");
  await ensureDirectory(directory);
  const path = join(directory, `postgres_${backupTimestamp()}.sql.gz`);
  try {
    const result = await options.docker.execToFile(
      options.postgresContainer,
      [
        "sh",
        "-c",
        'set -o pipefail; PGPASSWORD="$POSTGRES_PASSWORD" pg_dumpall -U "$POSTGRES_USER" --clean --if-exists | gzip -c',
      ],
      path,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `pg_dumpall failed (${result.exitCode}): ${result.stderr}`,
      );
    }
    const sizeBytes = await fileSize(path);
    const deleted = await enforceRetention(directory, config.retentionCount);
    const durationMs = Date.now() - startedAt;
    return {
      output: backupSummary("PostgreSQL", path, sizeBytes, durationMs, deleted),
      metadata: { backupPath: path, backupSizeBytes: sizeBytes, durationMs },
    };
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function executeMongoBackup(
  config: MongoBackupTaskConfig,
  options: BackupExecutorOptions,
): Promise<ExecutorResult> {
  const startedAt = Date.now();
  const directory = join(options.backupDirectory, "mongodb");
  await ensureDirectory(directory);
  const path = join(directory, `mongodb_${backupTimestamp()}.archive.gz`);
  const databaseArguments =
    config.databases?.length === 1 ? [`--db=${config.databases[0]}`] : [];
  try {
    const result = await options.docker.execToFile(
      options.mongoContainer,
      [
        "sh",
        "-c",
        'exec mongodump --host=localhost --username="$MONGO_INITDB_ROOT_USERNAME" --password="$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase=admin "$@" --archive --gzip',
        "mongodump",
        ...databaseArguments,
      ],
      path,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `mongodump failed (${result.exitCode}): ${result.stderr}`,
      );
    }
    const sizeBytes = await fileSize(path);
    const deleted = await enforceRetention(directory, config.retentionCount);
    const durationMs = Date.now() - startedAt;
    const databaseLine = config.databases?.[0]
      ? `\nDatabase: ${config.databases[0]}`
      : "";
    return {
      output:
        backupSummary("MongoDB", path, sizeBytes, durationMs, deleted) +
        databaseLine,
      metadata: { backupPath: path, backupSizeBytes: sizeBytes, durationMs },
    };
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function executeFilesBackup(
  config: FilesBackupTaskConfig,
  options: BackupExecutorOptions,
): Promise<ExecutorResult> {
  const startedAt = Date.now();
  const directory = join(options.backupDirectory, "files");
  await ensureDirectory(directory);
  const extension = config.compress ? "tar.gz" : "tar";
  const path = join(directory, `files_${backupTimestamp()}.${extension}`);
  const sourcePaths = config.sourcePaths ?? ["/data/ssd", "/data/hdd"];
  try {
    const result = await runProcess([
      "tar",
      config.compress ? "-czf" : "-cf",
      path,
      ...sourcePaths,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`tar failed (${result.exitCode}): ${result.stderr}`);
    }
    const sizeBytes = await fileSize(path);
    const deleted = await enforceRetention(directory, config.retentionCount);
    const durationMs = Date.now() - startedAt;
    return {
      output: `${backupSummary(
        "Files",
        path,
        sizeBytes,
        durationMs,
        deleted,
      )}\nSources: ${sourcePaths.join(", ")}`,
      metadata: { backupPath: path, backupSizeBytes: sizeBytes, durationMs },
    };
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}
