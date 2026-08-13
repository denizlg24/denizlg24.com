import { and, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  files,
  folders,
  namespaceProjectionErrors,
  namespaceProjectionState,
  namespaceReapCandidates,
  namespaceScans,
} from "../db/schema";
import type { NamespaceEntry } from "./metadata-service";
import type { ProjectionRepository, ScanRecord } from "./namespace-projector";
import type {
  ProjectedRow,
  ReapCandidateState,
  ReconcilePlan,
} from "./namespace-reconcile";

function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index <= 0 ? "/" : `/${relativePath.slice(0, index)}`;
}

function absolutePath(relativePath: string): string {
  return relativePath === "/" || relativePath === "" ? "/" : `/${relativePath}`;
}

/** Deepest first, so a folder is only removed after everything beneath it. */
function leafFirst(rows: readonly ProjectedRow[]): ProjectedRow[] {
  return [...rows].sort(
    (left, right) =>
      right.relativePath.split("/").length -
        left.relativePath.split("/").length ||
      right.relativePath.localeCompare(left.relativePath),
  );
}

export function createProjectionRepository(db: Database): ProjectionRepository {
  return {
    /**
     * Reaps files first, then folders leaf-first.
     *
     * `files.folder_id` is `ON DELETE CASCADE`, so deleting a folder row would
     * silently take its file rows with it — including files the scan judged
     * present and never planned to remove. Every row here is deleted on its own
     * two-generation evidence, and ordering the deletes leaf-first means the
     * cascade never has anything left to act on.
     */
    async applyReapPlan(plan: ReconcilePlan): Promise<void> {
      const fileIds = plan.reap
        .filter((row) => row.kind === "file")
        .map((row) => row.id);
      const folderRows = leafFirst(
        plan.reap.filter((row) => row.kind === "folder"),
      );
      await db.transaction(async (tx) => {
        if (fileIds.length > 0) {
          await tx.delete(files).where(inArray(files.id, fileIds));
        }
        for (const folder of folderRows) {
          // Refuse to remove a folder that still has children: they were not
          // part of this plan, so the cascade would exceed the evidence.
          const [remaining] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(files)
            .where(eq(files.folderId, folder.id));
          if ((remaining?.count ?? 0) > 0) continue;
          const [childFolders] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(folders)
            .where(eq(folders.parentId, folder.id));
          if ((childFolders?.count ?? 0) > 0) continue;
          await tx.delete(folders).where(eq(folders.id, folder.id));
        }
        const reapedIds = plan.reap.map((row) => row.id);
        if (reapedIds.length > 0) {
          await tx
            .delete(namespaceReapCandidates)
            .where(inArray(namespaceReapCandidates.entryId, reapedIds));
        }
      });
    },

    async lastCompleteGeneration(): Promise<number | null> {
      const [row] = await db
        .select({ generation: namespaceScans.generation })
        .from(namespaceScans)
        .where(eq(namespaceScans.complete, true))
        .orderBy(desc(namespaceScans.generation))
        .limit(1);
      return row?.generation ?? null;
    },

    async findSubtreeByPath(relativePath: string): Promise<ProjectedRow[]> {
      const path = absolutePath(relativePath);
      const descendantPrefix = path === "/" ? "/" : `${path}/`;
      // `LIKE` would need escaping for perfectly valid `%` and `_` filename
      // characters. Comparing the literal prefix keeps those paths exact.
      const atOrBelow = <T>(column: T) =>
        sql`${column} = ${path} OR left(${column}, ${descendantPrefix.length}) = ${descendantPrefix}`;
      const [fileRows, folderRows] = await Promise.all([
        db
          .select({ id: files.id, path: files.path })
          .from(files)
          .where(atOrBelow(files.path)),
        db
          .select({ id: folders.id, path: folders.path })
          .from(folders)
          .where(atOrBelow(folders.path)),
      ]);
      return [
        ...fileRows.map((row) => ({
          id: row.id,
          kind: "file" as const,
          relativePath: row.path.replace(/^\//, ""),
        })),
        ...folderRows.map((row) => ({
          id: row.id,
          kind: "folder" as const,
          relativePath: row.path.replace(/^\//, ""),
        })),
      ];
    },

    async nextGeneration(): Promise<number> {
      const [row] = await db
        .select({ highest: max(namespaceScans.generation) })
        .from(namespaceScans);
      return (row?.highest ?? 0) + 1;
    },

    async persistCandidates(plan: ReconcilePlan): Promise<void> {
      await db.transaction(async (tx) => {
        if (plan.clearedCandidates.length > 0) {
          await tx
            .delete(namespaceReapCandidates)
            .where(
              inArray(namespaceReapCandidates.entryId, plan.clearedCandidates),
            );
        }
        for (const candidate of plan.candidates) {
          const row = plan.reap.find((entry) => entry.id === candidate.entryId);
          await tx
            .insert(namespaceReapCandidates)
            .values({
              entryId: candidate.entryId,
              firstMissedGeneration: candidate.firstMissedGeneration,
              kind: row?.kind ?? "file",
              lastMissedGeneration: candidate.lastMissedGeneration,
              relativePath: row?.relativePath ?? "",
            })
            .onConflictDoUpdate({
              set: {
                lastMissedGeneration: candidate.lastMissedGeneration,
              },
              target: namespaceReapCandidates.entryId,
            });
        }
      });
    },

    async projectedRows(): Promise<ProjectedRow[]> {
      const [folderRows, fileRows] = await Promise.all([
        db.select({ id: folders.id, path: folders.path }).from(folders),
        db.select({ id: files.id, path: files.path }).from(files),
      ]);
      return [
        ...folderRows.map((row) => ({
          id: row.id,
          kind: "folder" as const,
          relativePath: row.path.replace(/^\//, ""),
        })),
        ...fileRows.map((row) => ({
          id: row.id,
          kind: "file" as const,
          relativePath: row.path.replace(/^\//, ""),
        })),
      ];
    },

    async reapCandidates(): Promise<ReapCandidateState[]> {
      const rows = await db
        .select({
          entryId: namespaceReapCandidates.entryId,
          firstMissedGeneration: namespaceReapCandidates.firstMissedGeneration,
          lastMissedGeneration: namespaceReapCandidates.lastMissedGeneration,
        })
        .from(namespaceReapCandidates);
      return rows;
    },

    async recordProblem(generation, problem): Promise<void> {
      await db
        .insert(namespaceProjectionErrors)
        .values({
          code: problem.code,
          detail: problem.detail ?? null,
          firstSeenGeneration: generation,
          lastSeenGeneration: generation,
          relativePath: problem.relativePath,
        })
        .onConflictDoUpdate({
          set: {
            code: problem.code,
            detail: problem.detail ?? null,
            lastSeenGeneration: generation,
            // A problem seen again is not repaired, whatever a previous scan
            // concluded.
            repairedAt: null,
            updatedAt: new Date(),
          },
          target: namespaceProjectionErrors.relativePath,
        });
    },

    async clearProblem(relativePath: string): Promise<void> {
      // Deleted rather than marked repaired: the row exists to say the
      // projection does not describe the namespace, and once identity is
      // assigned it does. A repaired-but-present row would keep reading as
      // outstanding to anything counting rows rather than reading timestamps.
      await db
        .delete(namespaceProjectionErrors)
        .where(eq(namespaceProjectionErrors.relativePath, relativePath));
    },

    async recordScan(scan: ScanRecord): Promise<void> {
      await db.insert(namespaceScans).values({
        abortReason: scan.abortReason,
        branchMarkers: scan.branchMarkers,
        complete: scan.complete,
        filesSeen: scan.filesSeen,
        finishedAt: scan.finishedAt,
        foldersSeen: scan.foldersSeen,
        generation: scan.generation,
        problemsSeen: scan.problemsSeen,
        reapedRows: scan.reapedRows,
        startedAt: scan.startedAt,
      });
      if (scan.complete) {
        // The state row carries what a complete scan proved. Without this,
        // health reports "no complete scan yet" forever even as generations
        // succeed, because nothing else writes these columns.
        await db
          .insert(namespaceProjectionState)
          .values({
            id: true,
            lastCompleteAt: scan.finishedAt,
            lastCompleteGeneration: scan.generation,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            set: {
              lastCompleteAt: scan.finishedAt,
              lastCompleteGeneration: scan.generation,
              updatedAt: new Date(),
            },
            target: namespaceProjectionState.id,
          });
        // Problems recorded in an earlier generation and not seen in this
        // complete one are resolved.
        await db
          .update(namespaceProjectionErrors)
          .set({ repairedAt: new Date() })
          .where(
            and(
              isNull(namespaceProjectionErrors.repairedAt),
              sql`${namespaceProjectionErrors.lastSeenGeneration} < ${scan.generation}`,
            ),
          );
      }
    },

    async setDirty(dirty: boolean, reason: string | null): Promise<void> {
      const now = new Date();
      await db
        .insert(namespaceProjectionState)
        .values({
          dirty,
          dirtyReason: reason,
          dirtySince: dirty ? now : null,
          id: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            dirty,
            dirtyReason: reason,
            // Keep the original dirty timestamp so dirty *age* is measurable
            // rather than reset by every scan that finds it still dirty.
            //
            // The fallback is bound as an explicitly cast ISO string. A `Date`
            // interpolated into a `sql` template does not go through the
            // column's timestamp mapper, so it arrives as the JS `toString()`
            // form against a timestamptz column and the whole statement fails —
            // taking the scan with it.
            dirtySince: dirty
              ? sql`coalesce(${namespaceProjectionState.dirtySince}, ${now.toISOString()}::timestamptz)`
              : null,
            updatedAt: now,
          },
          target: namespaceProjectionState.id,
        });
    },

    async upsertFile(entry: NamespaceEntry): Promise<void> {
      const path = absolutePath(entry.relativePath);
      const [folder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.path, parentOf(entry.relativePath)))
        .limit(1);
      if (!folder) {
        throw new Error(`No projected parent folder for ${path}`);
      }
      // `files.owner_id` is NOT NULL with a foreign key, unlike `folders`, so an
      // ownerless file is not a row this table can hold. Coercing the null to ""
      // used to push that decision into Postgres, which rejected it as a
      // malformed uuid — a nineteen-parameter SQL dump for what is really one
      // sentence about the entry.
      const ownerId = entry.metadata.ownerId;
      if (!ownerId) {
        throw new Error(
          `Refusing to project ownerless file ${path}: only the shared root is ownerless, and a file needs an owner`,
        );
      }
      // `files` is unique on `path` as well as on `id`, and the two disagree
      // whenever a path is re-created under a new identity — which is routine:
      // an editor that writes through a temp file deletes and recreates the
      // same name, and the new entry carries a new stamped id.
      //
      // `ON CONFLICT (id)` cannot absorb a violation of `files_path_unique`, so
      // that insert raised instead of upserting. Reconciliation is what clears
      // the displaced row, but reconciliation only runs on a *complete* scan,
      // and the raise was preventing completion — the stale row blocked the one
      // pass that removes it.
      //
      // The namespace is the authority on what lives at a path, so the row
      // holding it under another id is stale by definition. A file that merely
      // moved is re-inserted at its true path by its own entry later in the
      // same walk; it forfeits `tier`, `access_count` and `last_accessed_at`,
      // which are a hint and two analytics counters, not identity.
      await db.transaction(async (tx) => {
        await tx
          .delete(files)
          .where(and(eq(files.path, path), ne(files.id, entry.metadata.id)));
        await tx
          .insert(files)
          .values({
            checksum: entry.metadata.checksum ?? "",
            createdAt: new Date(entry.metadata.createdAt),
            diskPath: entry.absolutePath,
            filename: path.slice(path.lastIndexOf("/") + 1),
            folderId: folder.id,
            id: entry.metadata.id,
            mimeType: entry.metadata.mimeType ?? null,
            ownerId,
            path,
            sizeBytes: entry.sizeBytes,
            updatedAt: entry.modifiedAt,
          })
          .onConflictDoUpdate({
            set: {
              checksum: entry.metadata.checksum ?? "",
              diskPath: entry.absolutePath,
              filename: path.slice(path.lastIndexOf("/") + 1),
              folderId: folder.id,
              mimeType: entry.metadata.mimeType ?? null,
              path,
              sizeBytes: entry.sizeBytes,
              updatedAt: entry.modifiedAt,
            },
            target: files.id,
          });
      });
    },

    async upsertFolder(entry: NamespaceEntry): Promise<void> {
      const path = absolutePath(entry.relativePath);
      const parent = parentOf(entry.relativePath);
      const [parentRow] =
        parent === "/"
          ? [undefined]
          : await db
              .select({ id: folders.id })
              .from(folders)
              .where(eq(folders.path, parent))
              .limit(1);
      // Same two-unique-keys problem as `upsertFile`: a folder deleted and
      // recreated over SMB keeps its name and gets a new stamped id, so the
      // path collides under `folders_path_unique` while `ON CONFLICT (id)`
      // looks elsewhere. This is the common case behind renames not landing.
      //
      // It cannot be resolved the way a file is, by deleting the displaced row.
      // `files.folder_id` references `folders.id` ON DELETE CASCADE, so that
      // would take every projected file beneath the folder with it, and
      // `projects.storage_folder_id` would quietly go NULL. The children are
      // real — the walk has just listed them — so they are carried across to
      // the new identity instead: free the path, insert under the new id,
      // re-point what referenced the old one, then drop it. `folders.parent_id`
      // carries no foreign key, so it has to be re-pointed explicitly rather
      // than by cascade.
      const [displaced] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.path, path), ne(folders.id, entry.metadata.id)))
        .limit(1);
      if (displaced) {
        await db.transaction(async (tx) => {
          // Real paths are absolute, so this prefix cannot collide with one.
          await tx
            .update(folders)
            .set({ path: `:displaced:${displaced.id}:${path}` })
            .where(eq(folders.id, displaced.id));
          await tx.insert(folders).values({
            createdAt: new Date(entry.metadata.createdAt),
            id: entry.metadata.id,
            name: path.slice(path.lastIndexOf("/") + 1),
            ownerId: entry.metadata.ownerId,
            parentId: parentRow?.id ?? null,
            path,
            updatedAt: entry.modifiedAt,
          });
          await tx
            .update(files)
            .set({ folderId: entry.metadata.id })
            .where(eq(files.folderId, displaced.id));
          await tx
            .update(folders)
            .set({ parentId: entry.metadata.id })
            .where(eq(folders.parentId, displaced.id));
          await tx.delete(folders).where(eq(folders.id, displaced.id));
        });
        return;
      }
      await db
        .insert(folders)
        .values({
          createdAt: new Date(entry.metadata.createdAt),
          id: entry.metadata.id,
          name: path.slice(path.lastIndexOf("/") + 1),
          ownerId: entry.metadata.ownerId,
          parentId: parentRow?.id ?? null,
          path,
          updatedAt: entry.modifiedAt,
        })
        .onConflictDoUpdate({
          set: {
            name: path.slice(path.lastIndexOf("/") + 1),
            ownerId: entry.metadata.ownerId,
            parentId: parentRow?.id ?? null,
            path,
            updatedAt: entry.modifiedAt,
          },
          target: folders.id,
        });
    },
  };
}
