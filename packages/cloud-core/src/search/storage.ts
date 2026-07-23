import type { StorageTier } from "@repo/schemas/cloud";
import type { Meilisearch, SearchParams } from "meilisearch";

export const STORAGE_INDEX_UID = "_storage_files";

export interface StorageSearchDocument {
  id: string;
  name: string;
  path: string;
  rootPath: string;
  type: "file" | "folder";
  ownerId: string;
  scope: "user" | "shared";
  mimeType?: string | null;
  sizeBytes?: number;
  tier?: StorageTier;
  folderId?: string | null;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StorageSearchResult {
  hits: StorageSearchDocument[];
  totalHits: number;
  page: number;
  totalPages: number;
}

function deriveScope(path: string): "user" | "shared" {
  return path === "/shared" || path.startsWith("/shared/") ? "shared" : "user";
}

function deriveRootPath(path: string): string {
  const separator = path.indexOf("/", 1);
  return separator === -1 ? path : path.slice(0, separator);
}

export async function ensureStorageSearchIndex(
  meili: Meilisearch,
): Promise<void> {
  try {
    await meili.getIndex(STORAGE_INDEX_UID);
  } catch {
    await meili.createIndex(STORAGE_INDEX_UID, { primaryKey: "id" }).waitTask();
  }

  await meili
    .index(STORAGE_INDEX_UID)
    .updateSettings({
      searchableAttributes: ["name"],
      filterableAttributes: ["ownerId", "rootPath", "type", "scope"],
      sortableAttributes: ["createdAt", "sizeBytes", "name"],
    })
    .waitTask();
}

export function buildFileDocument(file: {
  id: string;
  filename: string;
  path: string;
  ownerId: string;
  folderId: string;
  mimeType: string | null;
  sizeBytes: number;
  tier: StorageTier;
  createdAt: Date;
  updatedAt: Date;
}): StorageSearchDocument {
  return {
    id: file.id,
    name: file.filename,
    path: file.path,
    rootPath: deriveRootPath(file.path),
    type: "file",
    ownerId: file.ownerId,
    scope: deriveScope(file.path),
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    tier: file.tier,
    folderId: file.folderId,
    createdAt: file.createdAt.getTime(),
    updatedAt: file.updatedAt.getTime(),
  };
}

export function buildFolderDocument(folder: {
  id: string;
  name: string;
  path: string;
  ownerId: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StorageSearchDocument | null {
  if (!folder.ownerId) {
    return null;
  }

  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    rootPath: deriveRootPath(folder.path),
    type: "folder",
    ownerId: folder.ownerId,
    scope: deriveScope(folder.path),
    parentId: folder.parentId,
    createdAt: folder.createdAt.getTime(),
    updatedAt: folder.updatedAt.getTime(),
  };
}

export async function indexStorageDocuments(
  meili: Meilisearch,
  documents: StorageSearchDocument[],
): Promise<void> {
  const batchSize = 1000;
  const index = meili.index(STORAGE_INDEX_UID);

  for (let offset = 0; offset < documents.length; offset += batchSize) {
    await index.addDocuments(documents.slice(offset, offset + batchSize));
  }
}

export async function removeStorageDocuments(
  meili: Meilisearch,
  ids: string[],
): Promise<void> {
  if (ids.length > 0) {
    await meili.index(STORAGE_INDEX_UID).deleteDocuments(ids);
  }
}

export async function searchStorageIndex(
  meili: Meilisearch,
  query: string,
  options: {
    scope: "user" | "shared";
    ownerId?: string;
    rootPath?: string;
    type?: "file" | "folder";
    page?: number;
    hitsPerPage?: number;
  },
): Promise<StorageSearchResult> {
  const filterParts = [`scope = "${options.scope}"`];
  if (options.scope === "user" && options.ownerId) {
    filterParts.push(`ownerId = "${options.ownerId}"`);
  }
  if (options.rootPath) {
    filterParts.push(`rootPath = "${options.rootPath}"`);
  }
  if (options.type) {
    filterParts.push(`type = "${options.type}"`);
  }

  const page = options.page ?? 1;
  const hitsPerPage = options.hitsPerPage ?? 20;
  const searchOptions = {
    filter: filterParts.join(" AND "),
    page,
    hitsPerPage,
    sort: ["name:asc"],
  } as const satisfies SearchParams;
  const result = await meili
    .index(STORAGE_INDEX_UID)
    .search<StorageSearchDocument, typeof searchOptions>(query, searchOptions);

  return {
    hits: result.hits,
    totalHits: result.totalHits,
    page: result.page,
    totalPages: result.totalPages,
  };
}
