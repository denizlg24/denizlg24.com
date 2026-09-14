import type {
  FolderContents,
  Pagination,
  StorageFile,
  StorageFolder,
} from "@repo/schemas/cloud";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

/**
 * Query keys for everything the storage app reads. One place, so an
 * invalidation names the same key the hook subscribed with.
 */
export const keys = {
  roots: ["roots"] as const,
  folders: ["folder"] as const,
  folder: (id: string) => ["folder", id] as const,
  allChildren: ["children"] as const,
  children: (id: string) => ["children", id] as const,
  file: (id: string) => ["file", id] as const,
  recent: ["recent"] as const,
  shares: ["shares"] as const,
  share: (id: string) => ["share", id] as const,
  devices: ["devices"] as const,
  people: ["people"] as const,
  usage: ["usage"] as const,
  search: (q: string, scope: string, page: number) =>
    ["search", q, scope, page] as const,
};

/** A row the server has not confirmed yet: a folder being created, or a move landing. */
export type CachedFolder = StorageFolder & { pending?: boolean };
export type CachedFile = StorageFile & { pending?: boolean };

export interface FolderPage {
  data: Omit<FolderContents, "subfolders" | "files"> & {
    subfolders: CachedFolder[];
    files: CachedFile[];
  };
  pagination: Pagination;
}

export type FolderData = InfiniteData<FolderPage, number>;
export type ChildrenData = CachedFolder[];

export interface FolderSnapshot {
  folder: FolderData | undefined;
  children: ChildrenData | undefined;
}

export function byName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function snapshotFolder(
  client: QueryClient,
  folderId: string,
): FolderSnapshot {
  return {
    folder: client.getQueryData<FolderData>(keys.folder(folderId)),
    children: client.getQueryData<ChildrenData>(keys.children(folderId)),
  };
}

export function restoreFolder(
  client: QueryClient,
  folderId: string,
  snapshot: FolderSnapshot,
): void {
  client.setQueryData<FolderData>(keys.folder(folderId), snapshot.folder);
  client.setQueryData<ChildrenData>(keys.children(folderId), snapshot.children);
}

/** Rewrites every loaded page of a folder listing. A folder never read is left cold. */
export function patchFolder(
  client: QueryClient,
  folderId: string,
  update: (page: FolderPage, index: number) => FolderPage,
): void {
  client.setQueryData<FolderData>(keys.folder(folderId), (current) =>
    current
      ? { ...current, pages: current.pages.map((page, i) => update(page, i)) }
      : current,
  );
}

export function patchChildren(
  client: QueryClient,
  folderId: string,
  update: (rows: ChildrenData) => ChildrenData,
): void {
  client.setQueryData<ChildrenData>(keys.children(folderId), (current) =>
    current ? update(current) : current,
  );
}

/** The listing's own folder row, for callers that need its path or parent. */
export function cachedFolder(
  client: QueryClient,
  folderId: string,
): FolderContents["folder"] | null {
  return (
    client.getQueryData<FolderData>(keys.folder(folderId))?.pages[0]?.data
      .folder ?? null
  );
}

export function insertSubfolder(
  client: QueryClient,
  parentId: string,
  folder: CachedFolder,
): void {
  patchFolder(client, parentId, (page, index) =>
    index === 0
      ? {
          ...page,
          data: {
            ...page.data,
            subfolders: byName([
              ...page.data.subfolders.filter((row) => row.id !== folder.id),
              folder,
            ]),
          },
        }
      : page,
  );
  patchChildren(client, parentId, (rows) =>
    byName([...rows.filter((row) => row.id !== folder.id), folder]),
  );
}

export function replaceSubfolder(
  client: QueryClient,
  parentId: string,
  previousId: string,
  folder: CachedFolder,
): void {
  const swap = (rows: CachedFolder[]) =>
    byName(rows.map((row) => (row.id === previousId ? folder : row)));
  patchFolder(client, parentId, (page) => ({
    ...page,
    data: { ...page.data, subfolders: swap(page.data.subfolders) },
  }));
  patchChildren(client, parentId, swap);
}

export function insertFile(
  client: QueryClient,
  folderId: string,
  file: CachedFile,
): void {
  patchFolder(client, folderId, (page, index) =>
    index === 0
      ? {
          ...page,
          data: {
            ...page.data,
            files: newestFirst([
              ...page.data.files.filter((row) => row.id !== file.id),
              file,
            ]),
          },
        }
      : page,
  );
}

/** Drops rows from a listing and its subfolder list. Ids may be files or folders. */
export function removeRows(
  client: QueryClient,
  folderId: string,
  ids: ReadonlySet<string>,
): void {
  patchFolder(client, folderId, (page) => ({
    ...page,
    data: {
      ...page.data,
      subfolders: page.data.subfolders.filter((row) => !ids.has(row.id)),
      files: page.data.files.filter((row) => !ids.has(row.id)),
    },
  }));
  patchChildren(client, folderId, (rows) =>
    rows.filter((row) => !ids.has(row.id)),
  );
}

export function renameFolderRow(
  client: QueryClient,
  parentId: string,
  folderId: string,
  patch: Partial<Pick<StorageFolder, "name" | "path">>,
): void {
  const apply = (rows: CachedFolder[]) =>
    byName(
      rows.map((row) => (row.id === folderId ? { ...row, ...patch } : row)),
    );
  patchFolder(client, parentId, (page) => ({
    ...page,
    data: { ...page.data, subfolders: apply(page.data.subfolders) },
  }));
  patchChildren(client, parentId, apply);
}

export function renameFileRow(
  client: QueryClient,
  folderId: string,
  fileId: string,
  patch: Partial<Pick<StorageFile, "filename" | "path">>,
): void {
  patchFolder(client, folderId, (page) => ({
    ...page,
    data: {
      ...page.data,
      files: page.data.files.map((row) =>
        row.id === fileId ? { ...row, ...patch } : row,
      ),
    },
  }));
}

/** The row for an id in a listing, if it is loaded. */
export function findRow(
  client: QueryClient,
  folderId: string,
  id: string,
):
  | { kind: "folder"; row: CachedFolder }
  | { kind: "file"; row: CachedFile }
  | null {
  const data = client.getQueryData<FolderData>(keys.folder(folderId));
  for (const page of data?.pages ?? []) {
    const folder = page.data.subfolders.find((row) => row.id === id);
    if (folder) return { kind: "folder", row: folder };
    const file = page.data.files.find((row) => row.id === id);
    if (file) return { kind: "file", row: file };
  }
  const child = client
    .getQueryData<ChildrenData>(keys.children(folderId))
    ?.find((row) => row.id === id);
  return child ? { kind: "folder", row: child } : null;
}

/**
 * Forgets every listing at or below a path. Renames and moves change the
 * paths of everything beneath a folder server-side, so any listing cached
 * under the old path describes rows that no longer exist at those paths.
 * Subfolder lists carry no path of their own and are invalidated wholesale;
 * only the ones on screen refetch, and an unchanged one answers 304.
 */
export function dropSubtree(client: QueryClient, folderPath: string): void {
  const prefix = `${folderPath}/`;
  client.removeQueries({
    queryKey: keys.folders,
    predicate: (query) => {
      const data = query.state.data as FolderData | undefined;
      const path = data?.pages[0]?.data.folder.path;
      return (
        path !== undefined && (path === folderPath || path.startsWith(prefix))
      );
    },
  });
  void client.invalidateQueries({ queryKey: keys.allChildren });
}

export async function invalidateFolder(
  client: QueryClient,
  ...folderIds: (string | null | undefined)[]
): Promise<void> {
  await Promise.all(
    folderIds
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .flatMap((id) => [
        client.invalidateQueries({ queryKey: keys.folder(id) }),
        client.invalidateQueries({ queryKey: keys.children(id) }),
      ]),
  );
}
