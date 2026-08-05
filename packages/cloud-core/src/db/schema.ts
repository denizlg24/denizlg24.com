import {
  ACTIVITY_ACTOR_TYPES,
  ACTIVITY_CATEGORIES,
  ACTIVITY_SEVERITIES,
  type ActivityMetadata,
  ALERT_AGGREGATES,
  ALERT_COMPARISONS,
  ALERT_RULE_STATES,
  ALERT_RULE_UNITS,
  NOTIFICATION_TYPES,
  type NotificationPayload,
  type TaskConfig,
  type TaskRunMetadata,
} from "@repo/schemas/cloud";
import {
  type InferInsertModel,
  type InferSelectModel,
  relations,
} from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type { TaskConfig, TaskRunMetadata } from "@repo/schemas/cloud";

export const userRoleEnum = pgEnum("user_role", ["superuser", "user"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const userStatusEnum = pgEnum("user_status", ["pending", "active"]);
export type UserStatus = (typeof userStatusEnum.enumValues)[number];

export const storageTierEnum = pgEnum("storage_tier", ["ssd", "hdd"]);
export type StorageTier = (typeof storageTierEnum.enumValues)[number];

export const uploadStatusEnum = pgEnum("upload_status", [
  "in_progress",
  "completed",
  "expired",
]);
export type UploadStatus = (typeof uploadStatusEnum.enumValues)[number];

export const taskTypeEnum = pgEnum("task_type", [
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
  "restart_container",
  "reboot_server",
  "tiering_pass",
  "metrics_rollup",
  "alert_evaluation",
  "run_command",
]);
export type TaskType = (typeof taskTypeEnum.enumValues)[number];

export const taskRunStatusEnum = pgEnum("task_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskRunStatus = (typeof taskRunStatusEnum.enumValues)[number];

export const syncStatusEnum = pgEnum("sync_status", [
  "idle",
  "syncing",
  "error",
]);
export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];

export const dbTypeEnum = pgEnum("db_type", ["postgres", "mongodb", "redis"]);
export type DbType = (typeof dbTypeEnum.enumValues)[number];

export const collectionSourceTypeEnum = pgEnum("collection_source_type", [
  "mongodb",
  "postgres",
]);
export type CollectionSourceType =
  (typeof collectionSourceTypeEnum.enumValues)[number];

export const activityCategoryEnum = pgEnum(
  "activity_category",
  ACTIVITY_CATEGORIES,
);
export const activitySeverityEnum = pgEnum(
  "activity_severity",
  ACTIVITY_SEVERITIES,
);
export const activityActorTypeEnum = pgEnum(
  "activity_actor_type",
  ACTIVITY_ACTOR_TYPES,
);
export const notificationTypeEnum = pgEnum(
  "notification_type",
  NOTIFICATION_TYPES,
);
export const alertAggregateEnum = pgEnum("alert_aggregate", ALERT_AGGREGATES);
export const alertComparisonEnum = pgEnum(
  "alert_comparison",
  ALERT_COMPARISONS,
);
export const alertRuleStateEnum = pgEnum("alert_rule_state", ALERT_RULE_STATES);
export const alertRuleUnitEnum = pgEnum("alert_rule_unit", ALERT_RULE_UNITS);

export interface FieldMapping {
  includeFields?: string[];
  excludeFields?: string[];
  searchableAttributes?: string[];
  filterableAttributes?: string[];
  sortableAttributes?: string[];
  primaryKey?: string;
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("user"),
  status: userStatusEnum("status").notNull().default("active"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const totpSecrets = pgTable("totp_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  encryptedSecret: text("encrypted_secret").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("recovery_codes_user_id_idx").on(table.userId)],
);

/**
 * Per-device passwords for the WebDAV mount. Finder and Explorer only speak
 * Basic/Digest, so neither the session cookie nor a Bearer API key can reach
 * `/dav` — these are the only credential that can, and they are scoped to it.
 */
export const davCredentials = pgTable(
  "dav_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    secretPrefix: varchar("secret_prefix", { length: 12 }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("dav_credentials_user_id_idx").on(table.userId)],
);

/**
 * Per-device SMB access. Samba owns the credential material — NTLM is
 * challenge-response, so it needs the secret in its own passdb and cannot use
 * the Argon2 hashes `dav_credentials` stores. This table therefore holds only
 * safe metadata plus the Unix/Samba principal that ties a device back to one
 * cloud account, and is the record ops and revocation work from.
 *
 * `revokedAt` is set before the Samba account is disabled, so a crash between
 * the two leaves a credential that reads as revoked but might still
 * authenticate — recoverable by re-running revocation. The reverse order would
 * leave one that reads as live but cannot log in, which looks like a broken
 * device rather than a completed revocation.
 */
export const smbCredentials = pgTable(
  "smb_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The non-login Unix/Samba principal; unique across all devices. */
    principal: varchar("principal", { length: 64 }).notNull().unique(),
    deviceName: varchar("device_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", {
      withTimezone: true,
    }),
    lastAuthenticatedFrom: varchar("last_authenticated_from", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: varchar("revoked_reason", { length: 255 }),
    failedAuthCount: integer("failed_auth_count").notNull().default(0),
    lastFailedAuthAt: timestamp("last_failed_auth_at", { withTimezone: true }),
  },
  (table) => [
    index("smb_credentials_user_id_idx").on(table.userId),
    index("smb_credentials_revoked_at_idx").on(table.revokedAt),
  ],
);

export type SmbCredential = InferSelectModel<typeof smbCredentials>;
export type NewSmbCredential = InferInsertModel<typeof smbCredentials>;

export type DavCredential = InferSelectModel<typeof davCredentials>;

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    parentId: uuid("parent_id"),
    path: text("path").notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("folders_owner_id_idx").on(table.ownerId),
    index("folders_parent_id_idx").on(table.parentId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 })
      .notNull()
      .unique("projects_slug_key"),
    description: text("description"),
    ownerId: uuid("owner_id").notNull(),
    storageFolderId: uuid("storage_folder_id"),
    meiliApiKeyUid: text("meili_api_key_uid"),
    meiliApiKey: text("meili_api_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("projects_owner_id_idx").on(table.ownerId),
    index("projects_slug_idx").on(table.slug),
    foreignKey({
      name: "projects_owner_id_fkey",
      columns: [table.ownerId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "projects_storage_folder_id_fkey",
      columns: [table.storageFolderId],
      foreignColumns: [folders.id],
    }).onDelete("set null"),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_project_id_idx").on(table.projectId),
    index("api_keys_key_prefix_idx").on(table.keyPrefix),
    foreignKey({
      name: "api_keys_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
  ],
);

export const s3Credentials = pgTable(
  "s3_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"),
    accessKeyId: varchar("access_key_id", { length: 64 })
      .notNull()
      .unique("s3_credentials_access_key_id_key"),
    secretAccessKeyHash: varchar("secret_access_key_hash", {
      length: 64,
    }).notNull(),
    encryptedSecretAccessKey: text("encrypted_secret_access_key").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretAuthTag: text("secret_auth_tag").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("s3_credentials_project_id_idx").on(table.projectId),
    foreignKey({
      name: "s3_credentials_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
  ],
);

export const projectCollections = pgTable(
  "project_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sourceType: collectionSourceTypeEnum("source_type")
      .notNull()
      .default("mongodb"),
    mongoDatabase: varchar("mongo_database", { length: 255 }),
    mongoCollection: varchar("mongo_collection", { length: 255 }),
    pgDatabase: varchar("pg_database", { length: 255 }),
    pgSchema: varchar("pg_schema", { length: 255 }),
    pgTable: varchar("pg_table", { length: 255 }),
    pgIdColumn: varchar("pg_id_column", { length: 255 }),
    pgOutboxCursor: bigint("pg_outbox_cursor", { mode: "number" })
      .notNull()
      .default(0),
    meiliIndexUid: varchar("meili_index_uid", { length: 255 })
      .notNull()
      .unique("project_collections_meili_index_uid_key"),
    fieldMapping: jsonb("field_mapping")
      .$type<FieldMapping>()
      .notNull()
      .default({}),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    syncStatus: syncStatusEnum("sync_status").notNull().default("idle"),
    resumeToken: jsonb("resume_token").$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    documentCount: integer("document_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_collections_project_id_idx").on(table.projectId),
    unique("project_collections_project_id_name_key").on(
      table.projectId,
      table.name,
    ),
    foreignKey({
      name: "project_collections_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
  ],
);

export const projectDatabases = pgTable(
  "project_databases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    type: dbTypeEnum("type").notNull(),
    dbName: varchar("db_name", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_databases_project_id_idx").on(table.projectId),
    uniqueIndex("project_databases_project_id_type_unique").on(
      table.projectId,
      table.type,
    ),
    foreignKey({
      name: "project_databases_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [projects.id],
    }).onDelete("cascade"),
  ],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    path: text("path").notNull().unique(),
    mimeType: varchar("mime_type", { length: 255 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    tier: storageTierEnum("tier").notNull().default("ssd"),
    diskPath: text("disk_path").notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("files_owner_id_idx").on(table.ownerId),
    index("files_folder_id_idx").on(table.folderId),
    index("files_tier_idx").on(table.tier),
    index("files_last_accessed_at_idx").on(table.lastAccessedAt),
  ],
);

export const tusUploads = pgTable(
  "tus_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    targetPath: text("target_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    bytesReceived: bigint("bytes_received", { mode: "number" })
      .notNull()
      .default(0),
    mimeType: varchar("mime_type", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    tempDiskPath: text("temp_disk_path").notNull(),
    status: uploadStatusEnum("status").notNull().default("in_progress"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tus_uploads_owner_id_idx").on(table.ownerId),
    index("tus_uploads_status_idx").on(table.status),
    index("tus_uploads_expires_at_idx").on(table.expiresAt),
  ],
);

export const scheduledTasks = pgTable(
  "scheduled_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    type: taskTypeEnum("type").notNull(),
    cronExpression: varchar("cron_expression", { length: 100 }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    config: jsonb("config").$type<TaskConfig>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scheduled_tasks_type_idx").on(table.type),
    index("scheduled_tasks_next_run_at_idx").on(table.nextRunAt),
    index("scheduled_tasks_enabled_idx").on(table.enabled),
    foreignKey({
      name: "scheduled_tasks_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
  ],
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    status: taskRunStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    output: text("output"),
    error: text("error"),
    metadata: jsonb("metadata").$type<TaskRunMetadata>(),
    failureNotifiedAt: timestamp("failure_notified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("task_runs_task_id_idx").on(table.taskId),
    index("task_runs_status_idx").on(table.status),
    index("task_runs_started_at_idx").on(table.startedAt),
    foreignKey({
      name: "task_runs_task_id_fkey",
      columns: [table.taskId],
      foreignColumns: [scheduledTasks.id],
    }).onDelete("cascade"),
  ],
);

export const metricsSamples = pgTable(
  "metrics_samples",
  {
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: doublePrecision("value").notNull(),
    intervalSeconds: smallint("interval_seconds").notNull().default(30),
  },
  (table) => [
    primaryKey({
      name: "metrics_samples_pkey",
      columns: [table.ts, table.kind, table.key, table.intervalSeconds],
    }),
    index("metrics_samples_ts_brin_idx").using("brin", table.ts),
    index("metrics_samples_series_ts_idx").on(
      table.kind,
      table.key,
      table.intervalSeconds,
      table.ts,
    ),
  ],
);

/**
 * Append-only. Rows are written from a buffer, never inside a request's critical
 * path, and pruned by the metrics_rollup task. `actorId` is deliberately not a
 * foreign key: an actor can be an API key, an S3 credential or a share token,
 * and deleting a user must not erase the record of what they did.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    category: activityCategoryEnum("category").notNull(),
    severity: activitySeverityEnum("severity").notNull().default("info"),
    action: varchar("action", { length: 128 }).notNull(),
    actorType: activityActorTypeEnum("actor_type").notNull().default("system"),
    actorId: varchar("actor_id", { length: 255 }),
    actorLabel: varchar("actor_label", { length: 255 }),
    method: varchar("method", { length: 10 }),
    path: varchar("path", { length: 2_048 }),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    targetType: varchar("target_type", { length: 64 }),
    targetId: varchar("target_id", { length: 255 }),
    message: text("message"),
    metadata: jsonb("metadata").$type<ActivityMetadata>(),
  },
  (table) => [
    index("activity_log_ts_brin_idx").using("brin", table.ts),
    index("activity_log_category_ts_idx").on(table.category, table.ts),
    index("activity_log_severity_ts_idx").on(table.severity, table.ts),
    index("activity_log_action_ts_idx").on(table.action, table.ts),
    index("activity_log_actor_ts_idx").on(table.actorId, table.ts),
    index("activity_log_status_ts_idx").on(table.statusCode, table.ts),
  ],
);

/**
 * One row per throttling key, upserted on every dispatch attempt. This is what
 * survives a container restart — the previous in-memory Map meant a redeploy
 * during an incident re-sent every alert.
 */
export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: varchar("event_key", { length: 512 }).notNull().unique(),
    type: notificationTypeEnum("type").notNull(),
    severity: activitySeverityEnum("severity").notNull().default("info"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    sendCount: integer("send_count").notNull().default(0),
    suppressedCount: integer("suppressed_count").notNull().default(0),
    lastPayload: jsonb("last_payload").$type<NotificationPayload>(),
  },
  (table) => [
    index("notification_events_type_idx").on(table.type),
    index("notification_events_last_seen_at_idx").on(table.lastSeenAt),
  ],
);

/**
 * A threshold over any series the sampler writes, which is what makes new
 * collectors alertable without a schema change.
 *
 * `breachingSince` is stamped the first time an evaluation sees the condition
 * hold and cleared when it stops, so `forSeconds` is measured against wall time
 * rather than against a sample count — the sampler skipping a beat must not
 * reset a sustained breach.
 */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }),
    enabled: boolean("enabled").notNull().default(true),
    series: varchar("series", { length: 512 }).notNull(),
    aggregate: alertAggregateEnum("aggregate").notNull().default("avg"),
    windowSeconds: integer("window_seconds").notNull().default(300),
    comparison: alertComparisonEnum("comparison").notNull().default("gt"),
    threshold: doublePrecision("threshold").notNull(),
    forSeconds: integer("for_seconds").notNull().default(0),
    severity: activitySeverityEnum("severity").notNull().default("warn"),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
    unit: alertRuleUnitEnum("unit").notNull().default("count"),
    state: alertRuleStateEnum("state").notNull().default("ok"),
    stateSince: timestamp("state_since", { withTimezone: true }),
    breachingSince: timestamp("breaching_since", { withTimezone: true }),
    lastValue: doublePrecision("last_value"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alert_rules_enabled_idx").on(table.enabled),
    index("alert_rules_series_idx").on(table.series),
  ],
);

export type AlertRuleRow = InferSelectModel<typeof alertRules>;
export type AlertRuleInsert = InferInsertModel<typeof alertRules>;

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  recoveryCodes: many(recoveryCodes),
  apiKeys: many(apiKeys),
  davCredentials: many(davCredentials),
  projects: many(projects),
  folders: many(folders),
  files: many(files),
  tusUploads: many(tusUploads),
  scheduledTasks: many(scheduledTasks),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const totpSecretsRelations = relations(totpSecrets, ({ one }) => ({
  user: one(users, { fields: [totpSecrets.userId], references: [users.id] }),
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
  user: one(users, { fields: [recoveryCodes.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ many, one }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  storageFolder: one(folders, {
    fields: [projects.storageFolderId],
    references: [folders.id],
  }),
  apiKeys: many(apiKeys),
  s3Credentials: many(s3Credentials),
  collections: many(projectCollections),
  databases: many(projectDatabases),
}));

export const davCredentialsRelations = relations(davCredentials, ({ one }) => ({
  user: one(users, { fields: [davCredentials.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
}));

export const s3CredentialsRelations = relations(s3Credentials, ({ one }) => ({
  project: one(projects, {
    fields: [s3Credentials.projectId],
    references: [projects.id],
  }),
}));

export const projectCollectionsRelations = relations(
  projectCollections,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectCollections.projectId],
      references: [projects.id],
    }),
  }),
);

export const projectDatabasesRelations = relations(
  projectDatabases,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDatabases.projectId],
      references: [projects.id],
    }),
  }),
);

export const foldersRelations = relations(folders, ({ many, one }) => ({
  owner: one(users, { fields: [folders.ownerId], references: [users.id] }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "parentChild",
  }),
  children: many(folders, { relationName: "parentChild" }),
  files: many(files),
}));

export const filesRelations = relations(files, ({ one }) => ({
  owner: one(users, { fields: [files.ownerId], references: [users.id] }),
  folder: one(folders, { fields: [files.folderId], references: [folders.id] }),
}));

export const tusUploadsRelations = relations(tusUploads, ({ one }) => ({
  owner: one(users, { fields: [tusUploads.ownerId], references: [users.id] }),
}));

export const scheduledTasksRelations = relations(
  scheduledTasks,
  ({ many, one }) => ({
    creator: one(users, {
      fields: [scheduledTasks.createdBy],
      references: [users.id],
    }),
    runs: many(taskRuns),
  }),
);

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  task: one(scheduledTasks, {
    fields: [taskRuns.taskId],
    references: [scheduledTasks.id],
  }),
}));

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;
export type TotpSecret = InferSelectModel<typeof totpSecrets>;
export type NewTotpSecret = InferInsertModel<typeof totpSecrets>;
export type RecoveryCode = InferSelectModel<typeof recoveryCodes>;
export type NewRecoveryCode = InferInsertModel<typeof recoveryCodes>;
export type Project = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;
export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;
export type S3Credential = InferSelectModel<typeof s3Credentials>;
export type NewS3Credential = InferInsertModel<typeof s3Credentials>;
export type ProjectCollection = InferSelectModel<typeof projectCollections>;
export type NewProjectCollection = InferInsertModel<typeof projectCollections>;
/**
 * One row per namespace scan. `generation` increments per completed scan and is
 * what the two-generation reap rule counts against.
 *
 * `complete` is the load-bearing field: a scan that aborted, overflowed, or ran
 * against an unmounted branch must never contribute a generation, because every
 * safety property of reaping assumes a generation means "the whole namespace
 * was observed".
 */
export const namespaceScans = pgTable(
  "namespace_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generation: bigint("generation", { mode: "number" }).notNull().unique(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    complete: boolean("complete").notNull().default(false),
    /** Branch markers observed at scan start, so a remount invalidates it. */
    branchMarkers: jsonb("branch_markers").$type<Record<string, string>>(),
    foldersSeen: integer("folders_seen").notNull().default(0),
    filesSeen: integer("files_seen").notNull().default(0),
    problemsSeen: integer("problems_seen").notNull().default(0),
    reapedRows: integer("reaped_rows").notNull().default(0),
    searchTaskUid: bigint("search_task_uid", { mode: "number" }),
    abortReason: text("abort_reason"),
  },
  (table) => [
    index("namespace_scans_generation_idx").on(table.generation),
    index("namespace_scans_started_at_idx").on(table.startedAt),
  ],
);

/**
 * Projector liveness, as a singleton row. Dirty means the incremental stream
 * cannot be trusted and a full scan is owed; it is set on watcher overflow,
 * projector restart and branch remount, and only ever cleared by a complete
 * scan.
 */
export const namespaceProjectionState = pgTable("namespace_projection_state", {
  id: boolean("id").primaryKey().default(true),
  dirty: boolean("dirty").notNull().default(true),
  dirtySince: timestamp("dirty_since", { withTimezone: true }),
  dirtyReason: text("dirty_reason"),
  lastCompleteGeneration: bigint("last_complete_generation", {
    mode: "number",
  }),
  lastCompleteAt: timestamp("last_complete_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  watcherOverflows: integer("watcher_overflows").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * An entry the projector could not project, kept per path so repair can be
 * tracked rather than rediscovered every scan.
 *
 * These are never a reason to delete bytes: an unreadable entry is a repair
 * item, and treating it as absent is precisely the mistake that turns a
 * metadata fault into data loss.
 */
export const namespaceProjectionErrors = pgTable(
  "namespace_projection_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    relativePath: text("relative_path").notNull().unique(),
    entryId: uuid("entry_id"),
    code: varchar("code", { length: 64 }).notNull(),
    detail: text("detail"),
    firstSeenGeneration: bigint("first_seen_generation", { mode: "number" }),
    lastSeenGeneration: bigint("last_seen_generation", { mode: "number" }),
    repairedAt: timestamp("repaired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("namespace_projection_errors_code_idx").on(table.code),
    index("namespace_projection_errors_repaired_at_idx").on(table.repairedAt),
  ],
);

/**
 * Rows a scan did not observe. A row must be missed by two consecutive complete
 * generations before it is reaped, so a single bad scan cannot delete the
 * projection.
 */
export const namespaceReapCandidates = pgTable(
  "namespace_reap_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull().unique(),
    kind: varchar("kind", { length: 16 }).notNull(),
    relativePath: text("relative_path").notNull(),
    firstMissedGeneration: bigint("first_missed_generation", {
      mode: "number",
    }).notNull(),
    lastMissedGeneration: bigint("last_missed_generation", {
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("namespace_reap_candidates_entry_idx").on(table.entryId)],
);

export type ProjectDatabase = InferSelectModel<typeof projectDatabases>;
export type NewProjectDatabase = InferInsertModel<typeof projectDatabases>;
export type Folder = InferSelectModel<typeof folders>;
export type NewFolder = InferInsertModel<typeof folders>;
export type StorageFile = InferSelectModel<typeof files>;
export type NewStorageFile = InferInsertModel<typeof files>;
export type TusUpload = InferSelectModel<typeof tusUploads>;
export type NewTusUpload = InferInsertModel<typeof tusUploads>;
export type ScheduledTask = InferSelectModel<typeof scheduledTasks>;
export type NewScheduledTask = InferInsertModel<typeof scheduledTasks>;
export type TaskRun = InferSelectModel<typeof taskRuns>;
export type NewTaskRun = InferInsertModel<typeof taskRuns>;
export type MetricsSample = InferSelectModel<typeof metricsSamples>;
export type NewMetricsSample = InferInsertModel<typeof metricsSamples>;
export type ActivityLogEntry = InferSelectModel<typeof activityLog>;
export type NewActivityLogEntry = InferInsertModel<typeof activityLog>;
export type NotificationEvent = InferSelectModel<typeof notificationEvents>;
export type NewNotificationEvent = InferInsertModel<typeof notificationEvents>;

export type NamespaceScan = InferSelectModel<typeof namespaceScans>;
export type NewNamespaceScan = InferInsertModel<typeof namespaceScans>;
export type NamespaceProjectionState = InferSelectModel<
  typeof namespaceProjectionState
>;
export type NamespaceProjectionError = InferSelectModel<
  typeof namespaceProjectionErrors
>;
export type NamespaceReapCandidate = InferSelectModel<
  typeof namespaceReapCandidates
>;

export * from "./auth-schema";
