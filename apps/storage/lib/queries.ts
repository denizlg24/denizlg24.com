"use client";

import type {
  FolderContents,
  FolderCrumb,
  Pagination,
  RootFolders,
  StorageFolder,
} from "@repo/schemas/cloud";
import {
  isServer,
  QueryClient,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, errorMessage, isApiError, isUnreachable } from "./api";
import {
  byName,
  type CachedFile,
  type CachedFolder,
  cachedFolder,
  dropSubtree,
  type FolderData,
  type FolderPage,
  findRow,
  insertFile,
  insertSubfolder,
  invalidateFolder,
  keys,
  removeRows,
  renameFileRow,
  renameFolderRow,
  replaceSubfolder,
  restoreFolder,
  snapshotFolder,
} from "./folder-cache";
import {
  type DeletableEntry,
  type DeleteFailure,
  PendingDeletes,
} from "./pending-deletes";

export type { DeletableEntry, DeleteFailure } from "./pending-deletes";
export { UNDO_WINDOW_MS } from "./pending-deletes";

const PAGE_SIZE = 100;
/** A listing is fresh for this long; a second mount inside it reads the cache. */
const FOLDER_STALE_MS = 10_000;
/** A listing on screen is re-read this often while the tab is visible. Unchanged folders answer 304. */
const FOLDER_POLL_MS = 15_000;
const CHILDREN_STALE_MS = 60_000;
/** Pages kept per folder. Scrolling further drops the first; a refetch re-reads what is kept. */
const MAX_PAGES = 5;
/** A 404 on an id created this recently is projection lag, not a missing folder. */
const RECENT_CREATE_MS = 10_000;

export type FolderErrorKind =
  | "not-found"
  | "forbidden"
  | "unreachable"
  | "other";

export function classifyError(error: unknown): FolderErrorKind {
  if (isUnreachable(error)) return "unreachable";
  if (isApiError(error)) {
    if (error.status === 404) return "not-found";
    if (error.status === 403) return "forbidden";
  }
  return "other";
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: FOLDER_STALE_MS,
        // Only a transport failure is worth retrying blind. A 404 or 403 is
        // an answer, and retrying it three times just delays saying so.
        retry: (failureCount, error) =>
          isUnreachable(error) && failureCount < 2,
        retryDelay: 1_000,
      },
    },
  });
}

/**
 * Everything the storage app holds per browser session: the query cache, the
 * delete-with-undo timers, and the folders created moments ago.
 *
 * One instance in the browser. On the server every call builds a fresh one:
 * nothing is prefetched there, and a client shared across requests would leak
 * one account's listing into another's render.
 */
export interface StorageSession {
  client: QueryClient;
  deletes: PendingDeletes;
  mutations: StorageMutations;
  /** Ids this client created, for the not-found insurance in `useFolder`. */
  recentCreates: Map<string, { parentId: string; name: string; at: number }>;
}

let browserSession: StorageSession | null = null;

export function createStorageSession(
  client: QueryClient,
  storageApi: StorageMutationApi,
): StorageSession {
  const recentCreates = new Map<
    string,
    { parentId: string; name: string; at: number }
  >();
  const deletes = new PendingDeletes(client, storageApi);
  const mutations = createStorageMutations(
    client,
    storageApi,
    deletes,
    recentCreates,
  );
  return { client, deletes, mutations, recentCreates };
}

export function getStorageSession(): StorageSession {
  if (isServer) return createStorageSession(makeQueryClient(), api);
  browserSession ??= createStorageSession(makeQueryClient(), api);
  return browserSession;
}

export function getQueryClient(): QueryClient {
  return getStorageSession().client;
}

/** The mutations bound to the browser session. Callable from outside React. */
export const storage: StorageMutations = {
  createFolder: (...args) =>
    getStorageSession().mutations.createFolder(...args),
  move: (...args) => getStorageSession().mutations.move(...args),
  renameFile: (...args) => getStorageSession().mutations.renameFile(...args),
  renameFolder: (...args) =>
    getStorageSession().mutations.renameFolder(...args),
  scheduleDelete: (...args) =>
    getStorageSession().mutations.scheduleDelete(...args),
  uploaded: (...args) => getStorageSession().mutations.uploaded(...args),
};

export interface StorageMutationApi {
  createFolder: typeof api.createFolder;
  updateFolder: typeof api.updateFolder;
  updateFile: typeof api.updateFile;
  deleteFile: typeof api.deleteFile;
  deleteFolder: typeof api.deleteFolder;
}

export interface MoveOutcome {
  moved: number;
  failures: { name: string; message: string }[];
}

export interface StorageMutations {
  /** Resolves with the server row; navigate into it only after that. */
  createFolder(parentId: string, name: string): Promise<StorageFolder>;
  renameFolder(id: string, parentId: string, name: string): Promise<void>;
  renameFile(id: string, folderId: string, filename: string): Promise<void>;
  move(
    entries: DeletableEntry[],
    sourceFolderId: string,
    targetFolderId: string,
  ): Promise<MoveOutcome>;
  scheduleDelete(
    entries: DeletableEntry[],
    folderId: string,
    onSettled?: (failures: DeleteFailure[]) => void,
  ): { undo: () => void };
  /** The upload queue finalized a file in a folder. */
  uploaded(folderId: string): void;
}

/**
 * The optimistic rules of §6.2, over a QueryClient rather than React state so
 * they can run from the upload queue and be tested without rendering.
 *
 * Every mutation follows the same shape: snapshot the keys it touches, patch
 * them, send, and on failure restore the snapshot; on settle, invalidate what
 * the server may now see differently. The invalidation is what makes the
 * listing converge on the truth even when the optimistic guess was wrong.
 */
export function createStorageMutations(
  client: QueryClient,
  storageApi: StorageMutationApi,
  deletes: PendingDeletes,
  recentCreates: StorageSession["recentCreates"],
): StorageMutations {
  const isRoot = (folderId: string) =>
    cachedFolder(client, folderId)?.parentId === null;

  return {
    async createFolder(parentId, name) {
      await deletes.commitMatching(parentId, name);
      const placeholderId = `pending:${crypto.randomUUID()}`;
      const placeholder: CachedFolder = {
        childCount: { files: 0, folders: 0 },
        createdAt: new Date().toISOString(),
        id: placeholderId,
        name,
        parentId,
        path: `${cachedFolder(client, parentId)?.path ?? ""}/${name}`,
        pending: true,
      };
      const snapshot = snapshotFolder(client, parentId);
      insertSubfolder(client, parentId, placeholder);
      try {
        const created = await storageApi.createFolder({ name, parentId });
        const folder: CachedFolder = {
          childCount: { files: 0, folders: 0 },
          createdAt: new Date().toISOString(),
          id: created.id,
          name: created.name,
          parentId: created.parentId,
          path: created.path,
        };
        replaceSubfolder(client, parentId, placeholderId, folder);
        recentCreates.set(created.id, {
          at: Date.now(),
          name: created.name,
          parentId,
        });
        return folder;
      } catch (error) {
        restoreFolder(client, parentId, snapshot);
        throw error;
      } finally {
        void invalidateFolder(client, parentId);
        if (isRoot(parentId)) {
          void client.invalidateQueries({ queryKey: keys.roots });
        }
      }
    },

    async renameFolder(id, parentId, name) {
      const snapshot = snapshotFolder(client, parentId);
      const previousPath = findRow(client, parentId, id)?.row.path ?? null;
      renameFolderRow(client, parentId, id, { name });
      try {
        const updated = await storageApi.updateFolder(id, { name });
        renameFolderRow(client, parentId, id, {
          name: updated.name,
          path: updated.path,
        });
        // Descendants' paths changed server-side; every listing cached below
        // the old path describes rows that are no longer there.
        if (previousPath) dropSubtree(client, previousPath);
      } catch (error) {
        restoreFolder(client, parentId, snapshot);
        throw error;
      } finally {
        void invalidateFolder(client, parentId);
      }
    },

    async renameFile(id, folderId, filename) {
      const snapshot = snapshotFolder(client, folderId);
      renameFileRow(client, folderId, id, { filename });
      try {
        const updated = await storageApi.updateFile(id, { filename });
        renameFileRow(client, folderId, id, {
          filename: updated.filename,
          path: updated.path,
        });
      } catch (error) {
        restoreFolder(client, folderId, snapshot);
        throw error;
      } finally {
        void invalidateFolder(client, folderId);
      }
    },

    async move(entries, sourceFolderId, targetFolderId) {
      const source = snapshotFolder(client, sourceFolderId);
      const target = snapshotFolder(client, targetFolderId);
      const rows = entries.map((entry) => ({
        entry,
        cached: findRow(client, sourceFolderId, entry.id),
      }));
      removeRows(client, sourceFolderId, new Set(entries.map((e) => e.id)));
      const targetPath = cachedFolder(client, targetFolderId)?.path ?? null;
      for (const { entry, cached } of rows) {
        if (!cached) continue;
        const landedPath = targetPath
          ? `${targetPath}/${entry.name}`
          : cached.row.path;
        if (cached.kind === "folder") {
          insertSubfolder(client, targetFolderId, {
            ...cached.row,
            parentId: targetFolderId,
            path: landedPath,
            pending: true,
          });
        } else {
          insertFile(client, targetFolderId, {
            ...cached.row,
            path: landedPath,
            pending: true,
          });
        }
      }

      // All at once, not one at a time: the old store serialized these, and a
      // twenty-item move took twenty round trips before the target updated.
      const results = await Promise.allSettled(
        rows.map(async ({ entry, cached }) => {
          if (entry.type === "file") {
            await storageApi.updateFile(entry.id, { folderId: targetFolderId });
          } else {
            await storageApi.updateFolder(entry.id, {
              parentId: targetFolderId,
            });
            if (cached?.kind === "folder") dropSubtree(client, cached.row.path);
          }
        }),
      );

      const failures: MoveOutcome["failures"] = [];
      const failedIds = new Set<string>();
      results.forEach((result, index) => {
        const { entry } = rows[index] as (typeof rows)[number];
        if (result.status === "rejected") {
          failures.push({
            message: errorMessage(result.reason),
            name: entry.name,
          });
          failedIds.add(entry.id);
        }
      });
      if (failedIds.size > 0) {
        // Put back only what did not land; the rest is the server's now.
        removeRows(client, targetFolderId, failedIds);
        for (const { entry, cached } of rows) {
          if (!failedIds.has(entry.id) || !cached) continue;
          if (cached.kind === "folder") {
            insertSubfolder(client, sourceFolderId, cached.row);
          } else {
            insertFile(client, sourceFolderId, cached.row);
          }
        }
      }
      if (failedIds.size === rows.length && rows.length > 0) {
        restoreFolder(client, sourceFolderId, source);
        restoreFolder(client, targetFolderId, target);
      }
      void invalidateFolder(client, sourceFolderId, targetFolderId);
      void client.invalidateQueries({ queryKey: keys.recent });
      return { failures, moved: rows.length - failedIds.size };
    },

    scheduleDelete(entries, folderId, onSettled) {
      return deletes.schedule(entries, folderId, onSettled);
    },

    uploaded(folderId) {
      void invalidateFolder(client, folderId);
      void client.invalidateQueries({ queryKey: keys.recent });
    },
  };
}

// ---------------------------------------------------------------------------
// Hooks

export function useRoots(): RootFolders | null {
  return useRootsState().roots;
}

/**
 * Roots plus the failure, so a caller with nothing else on screen can offer a
 * retry instead of spinning forever.
 */
export function useRootsState(): {
  roots: RootFolders | null;
  error: string | null;
  reload: () => void;
} {
  const query = useQuery({
    queryKey: keys.roots,
    queryFn: () => api.roots(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    error: query.error ? errorMessage(query.error) : null,
    reload: () => void query.refetch(),
    roots: query.data ?? null,
  };
}

export function userRootId(roots: RootFolders | null): string | null {
  if (!roots) return null;
  return "projectRoot" in roots ? roots.projectRoot.id : roots.userRoot.id;
}

/** id → when its delete is sent. Re-renders the subscriber on every change. */
export function usePendingDeletes(): ReadonlyMap<string, number> {
  const session = getStorageSession();
  return useSyncExternalStore(
    session.deletes.subscribe,
    session.deletes.snapshot,
    session.deletes.snapshot,
  );
}

export type FolderRow = CachedFolder & { deleteAt: number | null };
export type FileRow = CachedFile & { deleteAt: number | null };

export interface FolderView {
  folder: FolderContents["folder"] | null;
  ancestors: FolderCrumb[];
  subfolders: FolderRow[];
  files: FileRow[];
  pagination: Pagination | null;
  /** No listing yet. */
  loading: boolean;
  /** A listing is shown and a fresh one is on its way. */
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  errorKind: FolderErrorKind | null;
  retry: () => void;
  /**
   * Set when a folder this client just created answered 404 past its retries
   * and was found again under a different id: projection lag re-minted it.
   * The page should navigate there.
   */
  relocatedTo: string | null;
}

const EMPTY_VIEW: Omit<FolderView, "loadMore" | "retry"> = {
  ancestors: [],
  error: null,
  errorKind: null,
  files: [],
  folder: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  pagination: null,
  refreshing: false,
  relocatedTo: null,
  subfolders: [],
};

function isRecentCreate(session: StorageSession, id: string): boolean {
  const recent = session.recentCreates.get(id);
  return recent !== undefined && Date.now() - recent.at < RECENT_CREATE_MS;
}

/**
 * A folder id this client minted seconds ago that now answers 404 is looked up
 * again under its parent by name. The projection is eventually consistent by
 * design, and adoption can still re-mint an id in edge cases, so this stays
 * even though `createFolder` stamps identity server-side now.
 */
async function relocate(
  session: StorageSession,
  id: string,
): Promise<string | null> {
  const recent = session.recentCreates.get(id);
  if (!recent) return null;
  const children = await session.client.fetchQuery({
    queryKey: keys.children(recent.parentId),
    queryFn: () => api.folderChildren(recent.parentId),
    staleTime: 0,
  });
  const found = children.find((folder) => folder.name === recent.name);
  return found && found.id !== id ? found.id : null;
}

export function useFolder(id: string | null): FolderView {
  const session = getStorageSession();
  const [relocatedTo, setRelocatedTo] = useState<string | null>(null);
  const query = useInfiniteQuery<
    FolderPage,
    Error,
    FolderData,
    ReturnType<typeof keys.folder>,
    number
  >({
    queryKey: keys.folder(id ?? ""),
    queryFn: ({ pageParam, signal }) =>
      api.folderContents(
        id ?? "",
        { limit: PAGE_SIZE, page: pageParam },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages
        ? last.pagination.page + 1
        : undefined,
    maxPages: MAX_PAGES,
    enabled: id !== null,
    staleTime: FOLDER_STALE_MS,
    refetchInterval: FOLDER_POLL_MS,
    // Two quick retries for a folder this client just created — that 404 is
    // the projection catching up, not an answer.
    retry: (failureCount, error) => {
      if (isUnreachable(error)) return failureCount < 2;
      return (
        id !== null &&
        isApiError(error) &&
        error.status === 404 &&
        isRecentCreate(session, id) &&
        failureCount < 2
      );
    },
    retryDelay: 1_000,
  });

  const notFound =
    query.error !== null && classifyError(query.error) === "not-found";
  useEffect(() => {
    if (!id || !notFound || !isRecentCreate(session, id)) return;
    let cancelled = false;
    void relocate(session, id)
      .then((target) => {
        if (!cancelled && target) setRelocatedTo(target);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, notFound, session]);

  const deleting = usePendingDeletes();
  return useMemo<FolderView>(() => {
    const pages = query.data?.pages ?? [];
    const first = pages[0];
    const last = pages[pages.length - 1];
    const mark = <T extends { id: string }>(row: T) => ({
      ...row,
      deleteAt: deleting.get(row.id) ?? null,
    });
    const seen = new Set<string>();
    const files: FileRow[] = [];
    for (const page of pages) {
      for (const file of page.data.files) {
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        files.push(mark(file));
      }
    }
    return {
      ancestors: first?.data.ancestors ?? [],
      error: query.error ? errorMessage(query.error) : null,
      errorKind: query.error ? classifyError(query.error) : null,
      files,
      folder: first?.data.folder ?? null,
      hasMore: query.hasNextPage,
      loadMore: () => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      loading: query.isPending && id !== null,
      loadingMore: query.isFetchingNextPage,
      pagination: last?.pagination ?? null,
      refreshing: query.isFetching && !query.isPending,
      relocatedTo,
      retry: () => void query.refetch(),
      subfolders: byName(first?.data.subfolders ?? []).map(mark),
    };
  }, [
    deleting,
    id,
    query.data,
    query.error,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetching,
    query.isFetchingNextPage,
    query.isPending,
    query.refetch,
    relocatedTo,
  ]);
}

/**
 * Subfolders only, for the tree and the move picker. Reads no file page and
 * skips anything mid-delete, so a folder that is about to go cannot be
 * expanded or chosen as a destination.
 */
export function useChildren(id: string | null): {
  children: StorageFolder[];
  loading: boolean;
  error: string | null;
} {
  const query = useQuery({
    queryKey: keys.children(id ?? ""),
    queryFn: ({ signal }) => api.folderChildren(id ?? "", { signal }),
    enabled: id !== null,
    staleTime: CHILDREN_STALE_MS,
  });
  const deleting = usePendingDeletes();
  const children = useMemo(
    () => (query.data ?? []).filter((folder) => !deleting.has(folder.id)),
    [deleting, query.data],
  );
  return {
    children,
    error: query.error ? errorMessage(query.error) : null,
    loading: query.isPending && id !== null,
  };
}

/** Sends every pending delete before the page goes away. Mount once. */
export function usePendingDeleteFlush(): void {
  useEffect(() => {
    const session = getStorageSession();
    const flush = () => session.deletes.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

/** Fetch a folder's subfolders outside React, e.g. to resolve a name. */
export function fetchChildren(parentId: string): Promise<StorageFolder[]> {
  return getQueryClient().fetchQuery({
    queryKey: keys.children(parentId),
    queryFn: () => api.folderChildren(parentId),
    staleTime: 0,
  });
}

export { EMPTY_VIEW as EMPTY_FOLDER_VIEW };
