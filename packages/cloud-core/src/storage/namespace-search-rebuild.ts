import {
  buildFileDocument,
  buildFolderDocument,
  ensureStorageSearchIndex,
  type MeiliSearch,
  STORAGE_INDEX_UID,
  type StorageSearchDocument,
} from "../search";

export interface SearchRebuildSource {
  folders(): Promise<Parameters<typeof buildFolderDocument>[0][]>;
  files(): Promise<Parameters<typeof buildFileDocument>[0][]>;
}

export interface SearchRebuildResult {
  documents: number;
  skippedFolders: number;
  taskUid: number | null;
}

const BATCH = 1_000;

/**
 * Rebuilds the storage search index from the projection.
 *
 * Every batch is awaited to completion. Meilisearch indexing is asynchronous,
 * and `indexStorageDocuments` deliberately fires and forgets, which is right
 * for incremental writes and wrong here: a rebuild that returned before its
 * tasks settled would record a generation as searchable while the index was
 * still catching up, and the scan's `search_task_uid` would point at
 * unfinished work.
 *
 * Existing documents are cleared first so a rebuild cannot leave a document
 * whose entry no longer exists. That opens a window where search is
 * incomplete; it never opens one where search is wrong. The index is derived
 * state a scan can always regenerate, which is also why this rebuilds in place
 * rather than swapping — a swap index would double peak disk on a Pi whose SSD
 * headroom is the scarce resource.
 */
export async function rebuildStorageSearch(
  meili: MeiliSearch,
  source: SearchRebuildSource,
): Promise<SearchRebuildResult> {
  await ensureStorageSearchIndex(meili);
  const index = meili.index(STORAGE_INDEX_UID);

  const [folderRows, fileRows] = await Promise.all([
    source.folders(),
    source.files(),
  ]);

  const folderDocuments = folderRows
    .map(buildFolderDocument)
    // An ownerless folder has no document by design; the shared root is
    // addressed by path, not by owner-scoped search.
    .filter((document): document is StorageSearchDocument => document !== null);
  const documents: StorageSearchDocument[] = [
    ...folderDocuments,
    ...fileRows.map(buildFileDocument),
  ];

  await index.deleteAllDocuments().waitTask();

  let taskUid: number | null = null;
  for (let offset = 0; offset < documents.length; offset += BATCH) {
    const task = await index
      .addDocuments(documents.slice(offset, offset + BATCH))
      .waitTask();
    taskUid = (task as { uid?: number }).uid ?? taskUid;
  }

  return {
    documents: documents.length,
    skippedFolders: folderRows.length - folderDocuments.length,
    taskUid,
  };
}
