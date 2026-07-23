import {
  type InferInsertModel,
  type InferSelectModel,
  relations,
} from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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

export interface FieldMapping {
  includeFields?: string[];
  excludeFields?: string[];
  searchableAttributes?: string[];
  filterableAttributes?: string[];
  sortableAttributes?: string[];
  primaryKey?: string;
}

export interface TaskConfig {
  retentionCount?: number;
  containerNames?: string[];
  compress?: boolean;
  databases?: string[];
  sourcePaths?: string[];
}

export interface TaskRunMetadata {
  backupPath?: string;
  backupSizeBytes?: number;
  durationMs?: number;
  filesBackedUp?: number;
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

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  recoveryCodes: many(recoveryCodes),
  apiKeys: many(apiKeys),
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
  collections: many(projectCollections),
  databases: many(projectDatabases),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  project: one(projects, {
    fields: [apiKeys.projectId],
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
export type ProjectCollection = InferSelectModel<typeof projectCollections>;
export type NewProjectCollection = InferInsertModel<typeof projectCollections>;
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
