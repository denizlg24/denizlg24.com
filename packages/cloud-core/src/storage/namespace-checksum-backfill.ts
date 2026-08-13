import type {
  ChecksumBackfillBlock,
  ChecksumBackfillReport,
} from "@repo/schemas/cloud";
import { asc, eq, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import { files } from "../db/schema";
import { computeChecksum } from "./fs";
import type { NamespaceMetadataClient } from "./metadata-client";
import { MetadataClientError } from "./metadata-client";

export interface ChecksumBackfillCandidate {
  id: string;
  /** Namespace-relative, as the metadata socket names paths. */
  relativePath: string;
  /** Absolute, through the broker mount, as the API reads bytes. */
  absolutePath: string;
  sizeBytes: number;
}

export interface ChecksumBackfillRepository {
  /** Smallest first, so a run verifies as many rows as its budget allows. */
  listUnverified(limit: number): Promise<ChecksumBackfillCandidate[]>;
  countUnverified(): Promise<number>;
  recordChecksum(id: string, checksum: string): Promise<void>;
}

export interface ChecksumBackfillOptions {
  maxFiles: number;
  maxBytes: number;
  timeBudgetMs: number;
  migrationModeEnabled: boolean;
  backupRestoreActive: boolean;
  dryRun?: boolean;
  /** Overridable so tests do not depend on the wall clock. */
  now?: () => number;
  hash?: (absolutePath: string) => Promise<string>;
}

function emptyReport(
  blockedBy: ChecksumBackfillBlock | null,
  dryRun: boolean,
): ChecksumBackfillReport {
  return {
    blockedBy,
    bytesHashed: 0,
    dryRun,
    exhausted: null,
    failures: [],
    hashed: 0,
    pending: 0,
    remaining: 0,
    skipped: [],
  };
}

export function createChecksumBackfillRepository(
  db: Database,
  resolvePath: (file: {
    diskPath: string;
    id: string;
    path: string;
    tier: "ssd" | "hdd";
  }) => string,
): ChecksumBackfillRepository {
  // An empty string is what the projector writes for an entry whose checksum
  // xattr is absent, so it — not NULL — is the ordinary "not yet hashed" value.
  const unverified = or(isNull(files.checksum), eq(files.checksum, ""));
  return {
    async listUnverified(limit) {
      const rows = await db
        .select({
          diskPath: files.diskPath,
          id: files.id,
          path: files.path,
          sizeBytes: files.sizeBytes,
          tier: files.tier,
        })
        .from(files)
        .where(unverified)
        .orderBy(asc(files.sizeBytes))
        .limit(limit);
      return rows.map((row) => ({
        absolutePath: resolvePath(row),
        id: row.id,
        relativePath: row.path.replace(/^\//, ""),
        sizeBytes: row.sizeBytes,
      }));
    },

    async countUnverified() {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(files)
        .where(unverified);
      return row?.total ?? 0;
    },

    async recordChecksum(id, checksum) {
      await db
        .update(files)
        .set({ checksum, updatedAt: new Date() })
        .where(eq(files.id, id));
    },
  };
}

/**
 * Hashes the files nothing has ever hashed.
 *
 * Broker-mounted storage records a checksum in a protected xattr, and only an
 * upload through the API writes one. Everything arriving over SMB is stamped
 * `checksumState: "pending"` by adoption and then stays there: `recordChecksum`
 * — the one operation that moves an entry to `verified` — had no caller in the
 * codebase at all, and `assign`'s comment claiming "the projector recomputes it"
 * described work that was never written. So 81% of the namespace was unverified,
 * and since a tier move verifies the copy against a recorded checksum, tiering
 * could not move any of it however full the disk got. This is the missing half.
 *
 * The API is allowed to *read* bytes through the broker mount — it serves every
 * download that way — but it cannot write an xattr, so the digest goes back over
 * the socket for the privileged service to stamp. That keeps the boundary: the
 * filesystem stays the authority on metadata, and the projection picks the value
 * up again on the next scan rather than holding a fact only Postgres knows.
 *
 * Identity is re-checked after hashing rather than before. The window that
 * matters is a write landing *during* the read, which a check beforehand cannot
 * see; a path that was replaced by a different entry is skipped rather than
 * stamped with the digest of bytes that are no longer there.
 */
export async function runChecksumBackfill(
  repository: ChecksumBackfillRepository,
  client: Pick<NamespaceMetadataClient, "recordChecksum" | "verify">,
  options: ChecksumBackfillOptions,
): Promise<ChecksumBackfillReport> {
  const dryRun = options.dryRun === true;
  const now = options.now ?? (() => Date.now());
  // Reads through a descriptor into one reused buffer. A 629 MB file read with
  // `Bun.file().stream()` grew RSS by 680 MB that `Bun.gc(true)` would not give
  // back; this pass touches every file in the namespace, so that is the whole
  // difference between a nightly job and an OOM kill.
  const hash = options.hash ?? computeChecksum;

  // Both of these move bytes around underneath us: a migration relocates the
  // paths being read, and a restore is already saturating the disks. Neither is
  // a moment to walk the whole namespace reading every file.
  if (options.migrationModeEnabled)
    return emptyReport("migration-mode", dryRun);
  if (options.backupRestoreActive) {
    return emptyReport("backup-restore-active", dryRun);
  }

  const startedAt = now();
  const report = emptyReport(null, dryRun);
  report.pending = await repository.countUnverified();
  if (report.pending === 0) return report;

  const candidates = await repository.listUnverified(options.maxFiles);
  for (const candidate of candidates) {
    // Stop before overshooting rather than after: one file can be larger than
    // the whole budget. The `hashed > 0` guard is what keeps such a file from
    // deadlocking the pass — smallest first, so by the time an oversized one is
    // reached everything cheaper is done, and on a run where it comes first it
    // is read regardless.
    if (
      report.hashed > 0 &&
      report.bytesHashed + candidate.sizeBytes > options.maxBytes
    ) {
      report.exhausted = "bytes";
      break;
    }
    if (now() - startedAt >= options.timeBudgetMs) {
      report.exhausted = "time";
      break;
    }
    if (dryRun) {
      report.hashed += 1;
      report.bytesHashed += candidate.sizeBytes;
      continue;
    }

    let checksum: string;
    try {
      checksum = await hash(candidate.absolutePath);
    } catch (error) {
      // A row whose bytes are gone is the projection being stale, which the
      // scan repairs. Deleting it here would make a backfill a reaper.
      if (isMissing(error)) {
        report.skipped.push({
          reason: "missing",
          relativePath: candidate.relativePath,
        });
        continue;
      }
      report.failures.push({
        message: error instanceof Error ? error.message : "Hash failed",
        relativePath: candidate.relativePath,
      });
      continue;
    }

    try {
      await client.verify(candidate.relativePath, candidate.id);
      await client.recordChecksum(candidate.relativePath, checksum);
    } catch (error) {
      if (error instanceof MetadataClientError) {
        if (error.code === "ID_MISMATCH") {
          report.skipped.push({
            reason: "identity-changed",
            relativePath: candidate.relativePath,
          });
          continue;
        }
        // An unreachable socket will not fix itself inside this run, and
        // hashing on regardless would read the whole namespace for nothing.
        report.blockedBy = "metadata-unavailable";
        break;
      }
      throw error;
    }

    await repository.recordChecksum(candidate.id, checksum);
    report.hashed += 1;
    report.bytesHashed += candidate.sizeBytes;
  }

  report.remaining = dryRun
    ? Math.max(0, report.pending - report.hashed)
    : await repository.countUnverified();
  // The row cap is the only budget that cannot announce itself from inside the
  // loop: it was already applied by the query, so a full page with rows still
  // pending is what "there are more" looks like.
  if (
    !report.blockedBy &&
    !report.exhausted &&
    report.remaining > 0 &&
    candidates.length >= options.maxFiles
  ) {
    report.exhausted = "files";
  }
  return report;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "EISDIR")
  );
}
