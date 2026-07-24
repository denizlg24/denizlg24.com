import { describe, expect, it } from "bun:test";

import {
  apiKeys,
  collectionSourceTypeEnum,
  dbTypeEnum,
  files,
  folders,
  projectCollections,
  projectDatabases,
  projects,
  recoveryCodes,
  s3Credentials,
  scheduledTasks,
  sessions,
  storageTierEnum,
  syncStatusEnum,
  taskRunStatusEnum,
  taskRuns,
  taskTypeEnum,
  totpSecrets,
  tusUploads,
  uploadStatusEnum,
  userRoleEnum,
  userStatusEnum,
  users,
} from "./schema";

describe("cloud database schema", () => {
  it("preserves every production enum value and order", () => {
    expect(userRoleEnum.enumValues).toEqual(["superuser", "user"]);
    expect(userStatusEnum.enumValues).toEqual(["pending", "active"]);
    expect(storageTierEnum.enumValues).toEqual(["ssd", "hdd"]);
    expect(uploadStatusEnum.enumValues).toEqual([
      "in_progress",
      "completed",
      "expired",
    ]);
    expect(syncStatusEnum.enumValues).toEqual(["idle", "syncing", "error"]);
    expect(dbTypeEnum.enumValues).toEqual(["postgres", "mongodb", "redis"]);
    expect(collectionSourceTypeEnum.enumValues).toEqual([
      "mongodb",
      "postgres",
    ]);
    expect(taskTypeEnum.enumValues).toEqual([
      "backup_postgres",
      "backup_mongodb",
      "backup_files",
      "backup_all",
      "restart_container",
      "reboot_server",
      "tiering_pass",
      "metrics_rollup",
      "alert_evaluation",
    ]);
    expect(taskRunStatusEnum.enumValues).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
    ]);
  });

  it("describes the production tables plus project S3 credentials", () => {
    expect([
      users,
      sessions,
      totpSecrets,
      recoveryCodes,
      folders,
      projects,
      projectCollections,
      projectDatabases,
      apiKeys,
      s3Credentials,
      files,
      tusUploads,
      scheduledTasks,
      taskRuns,
    ]).toHaveLength(14);
  });

  it("preserves nullable and number-mode storage fields", () => {
    expect(folders.ownerId.notNull).toBe(false);
    expect(files.sizeBytes.dataType).toBe("number");
    expect(tusUploads.bytesReceived.dataType).toBe("number");
    expect(projectCollections.pgOutboxCursor.dataType).toBe("number");
  });
});
