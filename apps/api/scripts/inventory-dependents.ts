import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  apiKeys,
  createDb,
  type Database,
  projectCollections,
  projectDatabases,
  projects,
  requiredEnv,
  s3Credentials,
  users,
} from "@repo/cloud-core";
import { desc, eq, isNull } from "drizzle-orm";

import { runScript, ScriptError } from "./lib/runner";

/**
 * Enumerates every consumer-facing surface the old stack exposes, so plan 012's
 * dependent-project change list is generated from the live database rather than
 * from memory. Read-only by construction: there is no --execute path, and no
 * query selects a secret column (key hashes, encrypted passwords, encrypted S3
 * secrets and the Meilisearch key are reported as presence booleans only).
 */

interface ApiKeyRow {
  expiresAt: Date | null;
  keyPrefix: string;
  lastUsedAt: Date | null;
  name: string;
  scopes: string[];
}

interface S3CredentialRow {
  accessKeyId: string;
  label: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface DatabaseRow {
  dbName: string;
  type: "postgres" | "mongodb" | "redis";
  username: string;
}

interface CollectionRow {
  hasResumeToken: boolean;
  lastSyncedAt: Date | null;
  meiliIndexUid: string;
  name: string;
  syncEnabled: boolean;
  syncStatus: string;
}

interface ProjectInventory {
  apiKeys: ApiKeyRow[];
  collections: CollectionRow[];
  databases: DatabaseRow[];
  hasMeiliApiKey: boolean;
  lastActivityAt: Date | null;
  name: string;
  ownerUsername: string | null;
  s3Credentials: S3CredentialRow[];
  slug: string;
}

interface Inventory {
  generatedAt: string;
  legacyS3Credentials: S3CredentialRow[];
  projects: ProjectInventory[];
}

function latest(dates: (Date | null)[]): Date | null {
  let newest: Date | null = null;
  for (const date of dates) {
    if (date && (!newest || date > newest)) newest = date;
  }
  return newest;
}

async function collectInventory(db: Database): Promise<Inventory> {
  const projectRows = await db
    .select({
      hasMeiliApiKey: projects.meiliApiKey,
      id: projects.id,
      name: projects.name,
      ownerUsername: users.username,
      slug: projects.slug,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .orderBy(projects.slug);

  const inventory: ProjectInventory[] = [];

  for (const project of projectRows) {
    const [keyRows, credentialRows, databaseRows, collectionRows] =
      await Promise.all([
        db
          .select({
            expiresAt: apiKeys.expiresAt,
            keyPrefix: apiKeys.keyPrefix,
            lastUsedAt: apiKeys.lastUsedAt,
            name: apiKeys.name,
            scopes: apiKeys.scopes,
          })
          .from(apiKeys)
          .where(eq(apiKeys.projectId, project.id))
          .orderBy(desc(apiKeys.lastUsedAt)),
        db
          .select({
            accessKeyId: s3Credentials.accessKeyId,
            label: s3Credentials.label,
            lastUsedAt: s3Credentials.lastUsedAt,
            revokedAt: s3Credentials.revokedAt,
          })
          .from(s3Credentials)
          .where(eq(s3Credentials.projectId, project.id))
          .orderBy(desc(s3Credentials.lastUsedAt)),
        db
          .select({
            dbName: projectDatabases.dbName,
            type: projectDatabases.type,
            username: projectDatabases.username,
          })
          .from(projectDatabases)
          .where(eq(projectDatabases.projectId, project.id))
          .orderBy(projectDatabases.type),
        db
          .select({
            lastSyncedAt: projectCollections.lastSyncedAt,
            meiliIndexUid: projectCollections.meiliIndexUid,
            name: projectCollections.name,
            resumeToken: projectCollections.resumeToken,
            syncEnabled: projectCollections.syncEnabled,
            syncStatus: projectCollections.syncStatus,
          })
          .from(projectCollections)
          .where(eq(projectCollections.projectId, project.id))
          .orderBy(projectCollections.name),
      ]);

    inventory.push({
      apiKeys: keyRows,
      collections: collectionRows.map(({ resumeToken, ...rest }) => ({
        ...rest,
        hasResumeToken: resumeToken !== null,
      })),
      databases: databaseRows,
      hasMeiliApiKey: project.hasMeiliApiKey !== null,
      lastActivityAt: latest([
        ...keyRows.map((row) => row.lastUsedAt),
        ...credentialRows.map((row) => row.lastUsedAt),
      ]),
      name: project.name,
      ownerUsername: project.ownerUsername,
      s3Credentials: credentialRows,
      slug: project.slug,
    });
  }

  const legacyS3Credentials = await db
    .select({
      accessKeyId: s3Credentials.accessKeyId,
      label: s3Credentials.label,
      lastUsedAt: s3Credentials.lastUsedAt,
      revokedAt: s3Credentials.revokedAt,
    })
    .from(s3Credentials)
    .where(isNull(s3Credentials.projectId));

  return {
    generatedAt: new Date().toISOString(),
    legacyS3Credentials,
    projects: inventory,
  };
}

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "never";
}

function maskAccessKeyId(accessKeyId: string): string {
  return accessKeyId.length <= 8
    ? accessKeyId
    : `${accessKeyId.slice(0, 4)}…${accessKeyId.slice(-4)}`;
}

/**
 * The report is the change-list section of the cutover runbook. It is ordered
 * by last activity so the operator chases live consumers first and can see at a
 * glance which projects have not touched the platform in months.
 */
function renderReport(inventory: Inventory): string {
  const lines: string[] = [
    "# Dependent-project change list",
    "",
    `Generated ${inventory.generatedAt} by \`inventory-dependents.ts\` against the`,
    "live cloud database. Regenerate immediately before the cutover window.",
    "",
    "**Every consumer below must change its S3 endpoint at cutover:**",
    "",
    "| Key | Old value | New value |",
    "|-----|-----------|-----------|",
    "| `S3_ENDPOINT` | `https://storage.denizlg24.com/v2` | `https://api.denizlg24.com/v2` |",
    "",
    "Database hosts, ports and credentials are unchanged (invariant 1).",
    "Meilisearch keys and tenant tokens are unchanged (invariant 2).",
    "",
    "## Legacy global S3 credential",
    "",
  ];

  if (inventory.legacyS3Credentials.length === 0) {
    lines.push(
      "None present yet — the NULL-project row is created by the new API at",
      "first boot from `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.",
      "",
    );
  } else {
    lines.push("| Access key | Label | Last used | Revoked |");
    lines.push("|-----------|-------|-----------|---------|");
    for (const credential of inventory.legacyS3Credentials) {
      lines.push(
        `| \`${maskAccessKeyId(credential.accessKeyId)}\` | ${credential.label} | ${formatDate(credential.lastUsedAt)} | ${credential.revokedAt ? formatDate(credential.revokedAt) : "no"} |`,
      );
    }
    lines.push("");
    lines.push(
      "This single keypair is shared by every consumer today. Migrating them",
      "onto per-project credentials is a post-cutover task, not a blocker.",
      "",
    );
  }

  const ordered = [...inventory.projects].sort((a, b) => {
    const left = a.lastActivityAt?.getTime() ?? 0;
    const right = b.lastActivityAt?.getTime() ?? 0;
    return right - left;
  });

  lines.push(`## Projects (${ordered.length})`, "");
  lines.push(
    "| Project | Slug | Owner | Last activity | Keys | S3 | DBs | Indexes |",
  );
  lines.push(
    "|---------|------|-------|---------------|------|----|-----|---------|",
  );
  for (const project of ordered) {
    const activeKeys = project.apiKeys.filter(
      (key) => !key.expiresAt || key.expiresAt > new Date(),
    ).length;
    const activeCredentials = project.s3Credentials.filter(
      (credential) => credential.revokedAt === null,
    ).length;
    lines.push(
      `| ${project.name} | \`${project.slug}\` | ${project.ownerUsername ?? "—"} | ${formatDate(project.lastActivityAt)} | ${activeKeys} | ${activeCredentials} | ${project.databases.length} | ${project.collections.length} |`,
    );
  }
  lines.push("");

  for (const project of ordered) {
    lines.push(`### ${project.name} (\`${project.slug}\`)`, "");
    lines.push(
      `- Owner: ${project.ownerUsername ?? "—"}`,
      `- Last credential use: ${formatDate(project.lastActivityAt)}`,
      `- Meilisearch key issued: ${project.hasMeiliApiKey ? "yes" : "no"}`,
      "- [ ] Operator confirmed this project's envs updated",
      "",
    );

    if (project.databases.length > 0) {
      lines.push(
        "Provisioned databases (host/port/credentials unchanged):",
        "",
      );
      for (const database of project.databases) {
        lines.push(
          `- \`${database.type}\` — db \`${database.dbName}\`, user \`${database.username}\``,
        );
      }
      lines.push("");
    }

    if (project.s3Credentials.length > 0) {
      lines.push(`S3 credentials (bucket \`${project.slug}\`):`, "");
      for (const credential of project.s3Credentials) {
        lines.push(
          `- \`${maskAccessKeyId(credential.accessKeyId)}\` — ${credential.label}, last used ${formatDate(credential.lastUsedAt)}${credential.revokedAt ? ", REVOKED" : ""}`,
        );
      }
      lines.push("");
    }

    if (project.apiKeys.length > 0) {
      lines.push("API keys:", "");
      for (const key of project.apiKeys) {
        const scopes = key.scopes.length > 0 ? key.scopes.join(", ") : "none";
        const expiry = key.expiresAt
          ? `expires ${formatDate(key.expiresAt)}`
          : "no expiry";
        lines.push(
          `- \`${key.keyPrefix}…\` ${key.name} — scopes: ${scopes}; ${expiry}; last used ${formatDate(key.lastUsedAt)}`,
        );
      }
      lines.push("");
    }

    if (project.collections.length > 0) {
      lines.push(
        "Search indexes (resume tokens must survive — invariant 2):",
        "",
      );
      for (const collection of project.collections) {
        lines.push(
          `- \`${collection.meiliIndexUid}\` (${collection.name}) — ${collection.syncEnabled ? "sync on" : "sync off"}, status ${collection.syncStatus}, resume token ${collection.hasResumeToken ? "present" : "MISSING"}, last synced ${formatDate(collection.lastSyncedAt)}`,
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

await runScript("inventory-dependents", async (flags, log) => {
  if (!flags.dryRun) {
    throw new ScriptError(
      "inventory-dependents is read-only; --execute is not supported",
    );
  }

  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
  try {
    const inventory = await collectInventory(db);
    await log.event("collected", { projects: inventory.projects.length });

    if (flags.reportPath) {
      const reportPath = resolve(flags.reportPath);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, renderReport(inventory), {
        encoding: "utf8",
        mode: 0o600,
      });
      await log.event("report-written", { path: reportPath });
    }

    const withoutResumeToken = inventory.projects.flatMap((project) =>
      project.collections.filter(
        (collection) => collection.syncEnabled && !collection.hasResumeToken,
      ),
    ).length;

    return {
      collections: inventory.projects.reduce(
        (total, project) => total + project.collections.length,
        0,
      ),
      collectionsMissingResumeToken: withoutResumeToken,
      legacyS3Credentials: inventory.legacyS3Credentials.length,
      projects: inventory.projects.length,
      provisionedDatabases: inventory.projects.reduce(
        (total, project) => total + project.databases.length,
        0,
      ),
      reportPath: flags.reportPath ? resolve(flags.reportPath) : null,
    };
  } finally {
    await db.$client.end({ timeout: 5 });
  }
});
