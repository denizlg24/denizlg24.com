import { inArray } from "drizzle-orm";

import type { Database } from "../db";
import { files, folders } from "../db/schema";
import {
  buildFileDocument,
  buildFolderDocument,
  indexStorageDocuments,
  type MeiliSearch,
  type StorageSearchDocument,
} from "../search";
import type { NamespaceEntry } from "./metadata-service";
import type { ProjectionRepository } from "./namespace-projector";

const INDEX_BATCH = 500;

/**
 * Keeps the search index in step with whatever the projection writes.
 *
 * Deliberately not `rebuildStorageSearch`: that clears the index before
 * refilling it, which is right for a one-off repair but wrong on a schedule —
 * the scan runs every few minutes, and every run would leave search returning
 * nothing until the refill landed. Meilisearch's add is an upsert, so writing
 * the same documents again is idempotent and never empties the index.
 *
 * Documents for reaped rows are removed by the caller that owns the reap, since
 * that is where the deletion evidence lives.
 */
export function indexingProjectionRepository(
  base: ProjectionRepository,
  db: Database,
  meili: MeiliSearch,
): ProjectionRepository & { flushSearch(): Promise<number> } {
  const pendingFiles = new Set<string>();
  const pendingFolders = new Set<string>();

  const flushSearch = async (): Promise<number> => {
    const fileIds = [...pendingFiles];
    const folderIds = [...pendingFolders];
    pendingFiles.clear();
    pendingFolders.clear();
    if (fileIds.length === 0 && folderIds.length === 0) return 0;

    const documents: StorageSearchDocument[] = [];
    for (let offset = 0; offset < fileIds.length; offset += INDEX_BATCH) {
      const rows = await db
        .select()
        .from(files)
        .where(inArray(files.id, fileIds.slice(offset, offset + INDEX_BATCH)));
      for (const row of rows) documents.push(buildFileDocument(row));
    }
    for (let offset = 0; offset < folderIds.length; offset += INDEX_BATCH) {
      const rows = await db
        .select()
        .from(folders)
        .where(
          inArray(folders.id, folderIds.slice(offset, offset + INDEX_BATCH)),
        );
      for (const row of rows) {
        // An ownerless folder has no document by design; the shared root is
        // addressed by path rather than by owner-scoped search.
        const document = buildFolderDocument(row);
        if (document) documents.push(document);
      }
    }
    if (documents.length === 0) return 0;
    await indexStorageDocuments(meili, documents);
    return documents.length;
  };

  return {
    ...base,
    flushSearch,
    async upsertFile(entry: NamespaceEntry) {
      await base.upsertFile(entry);
      pendingFiles.add(entry.metadata.id);
    },
    async upsertFolder(entry: NamespaceEntry) {
      await base.upsertFolder(entry);
      pendingFolders.add(entry.metadata.id);
    },
  };
}
