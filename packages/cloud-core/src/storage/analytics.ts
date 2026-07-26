import type {
  LargestFile,
  StorageStats,
  StorageTypeBreakdown,
  UserStorageStat,
} from "@repo/schemas/cloud";
import { count, desc, eq, sql, sum } from "drizzle-orm";

import type { Database } from "../db";
import { files, folders, sessions, users } from "../db/schema";

function numeric(value: string | number | null): number {
  return Number(value ?? 0);
}

export async function storageStats(db: Database): Promise<StorageStats> {
  const [fileTotals, tierTotals, folderCount, userCount, sessionCount] =
    await Promise.all([
      db.select({ count: count(), total: sum(files.sizeBytes) }).from(files),
      db
        .select({
          tier: files.tier,
          count: count(),
          total: sum(files.sizeBytes),
        })
        .from(files)
        .groupBy(files.tier),
      db.select({ count: count() }).from(folders),
      db.select({ count: count() }).from(users),
      db
        .select({ count: count() })
        .from(sessions)
        .where(sql`${sessions.expiresAt} > now()`),
    ]);

  const byTier = new Map(tierTotals.map((row) => [row.tier, row]));
  const tier = (name: "ssd" | "hdd") => ({
    fileCount: byTier.get(name)?.count ?? 0,
    totalSizeBytes: numeric(byTier.get(name)?.total ?? 0),
  });

  return {
    files: {
      count: fileTotals[0]?.count ?? 0,
      totalSizeBytes: numeric(fileTotals[0]?.total ?? 0),
    },
    tiers: { ssd: tier("ssd"), hdd: tier("hdd") },
    folders: { count: folderCount[0]?.count ?? 0 },
    users: { count: userCount[0]?.count ?? 0 },
    activeSessions: { count: sessionCount[0]?.count ?? 0 },
    timestamp: new Date().toISOString(),
  };
}

export async function largestFiles(
  db: Database,
  limit = 20,
): Promise<LargestFile[]> {
  const rows = await db
    .select({
      id: files.id,
      filename: files.filename,
      path: files.path,
      sizeBytes: files.sizeBytes,
      tier: files.tier,
      ownerUsername: users.username,
    })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .orderBy(desc(files.sizeBytes))
    .limit(limit);
  return rows.map((row) => ({ ...row, sizeBytes: numeric(row.sizeBytes) }));
}

export async function storageByUser(db: Database): Promise<UserStorageStat[]> {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      fileCount: count(files.id),
      totalSizeBytes: sum(files.sizeBytes),
    })
    .from(users)
    .leftJoin(files, eq(files.ownerId, users.id))
    .groupBy(users.id, users.username)
    .orderBy(desc(sum(files.sizeBytes)));
  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    fileCount: row.fileCount,
    totalSizeBytes: numeric(row.totalSizeBytes),
  }));
}

/**
 * Extension rather than MIME type: mime_type is nullable and frequently
 * `application/octet-stream` for anything uploaded by a client that did not
 * bother, which collapses the breakdown into one useless bucket.
 */
export async function storageByType(
  db: Database,
  limit = 20,
): Promise<StorageTypeBreakdown[]> {
  const extension = sql<string>`
    coalesce(
      nullif(lower(substring(${files.filename} from '\\.([A-Za-z0-9]{1,12})$')), ''),
      '—'
    )
  `;
  const rows = await db
    .select({
      extension,
      fileCount: count(),
      totalSizeBytes: sum(files.sizeBytes),
    })
    .from(files)
    .groupBy(extension)
    .orderBy(desc(sum(files.sizeBytes)))
    .limit(limit);
  return rows.map((row) => ({
    extension: row.extension,
    fileCount: row.fileCount,
    totalSizeBytes: numeric(row.totalSizeBytes),
  }));
}
