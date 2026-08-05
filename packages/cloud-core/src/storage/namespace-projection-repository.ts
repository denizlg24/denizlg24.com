import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";

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
          firstSeenGeneration: generation,
          lastSeenGeneration: generation,
          relativePath: problem.relativePath,
        })
        .onConflictDoUpdate({
          set: {
            code: problem.code,
            lastSeenGeneration: generation,
            // A problem seen again is not repaired, whatever a previous scan
            // concluded.
            repairedAt: null,
            updatedAt: new Date(),
          },
          target: namespaceProjectionErrors.relativePath,
        });
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
            dirtySince: dirty
              ? sql`coalesce(${namespaceProjectionState.dirtySince}, ${now})`
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
      await db
        .insert(files)
        .values({
          checksum: entry.metadata.checksum ?? "",
          createdAt: new Date(entry.metadata.createdAt),
          diskPath: entry.absolutePath,
          filename: path.slice(path.lastIndexOf("/") + 1),
          folderId: folder.id,
          id: entry.metadata.id,
          mimeType: entry.metadata.mimeType ?? null,
          ownerId: entry.metadata.ownerId ?? "",
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
