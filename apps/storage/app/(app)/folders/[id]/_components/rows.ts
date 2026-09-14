import type { StorageTier } from "@repo/schemas/cloud";
import type { FileRow, FolderRow } from "@/lib/queries";

export interface BrowserRow {
  type: "file" | "folder";
  id: string;
  name: string;
  /** Folders have no stored size. */
  sizeBytes: number | null;
  updatedAt: string;
  createdAt: string;
  tier: StorageTier | null;
  mimeType: string | null;
  /** Set when the server can draw the file as itself. */
  thumbnail: boolean;
  /** Direct children, for a folder's "12 items". */
  childCount: { files: number; folders: number } | null;
  /** Who added it, when the listing says. */
  ownerId: string | null;
  /** The server has not confirmed this row yet. */
  pending: boolean;
  /** When its delete will be sent; null when it is not being deleted. */
  deleteAt: number | null;
  path: string;
}

export type SortKey = "name" | "size" | "updated" | "created" | "kind";
export type SortDirection = "asc" | "desc";

export const SORT_KEYS = [
  "name",
  "updated",
  "created",
  "size",
  "kind",
] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export const SORT_LABELS: Record<SortKey, string> = {
  created: "Date added",
  kind: "Kind",
  name: "Name",
  size: "Size",
  updated: "Date modified",
};

/** What each direction means for a key, so "ascending" never has to be decoded. */
export const SORT_DIRECTION_LABELS: Record<
  SortKey,
  Record<SortDirection, string>
> = {
  created: { asc: "Oldest first", desc: "Newest first" },
  kind: { asc: "A to Z", desc: "Z to A" },
  name: { asc: "A to Z", desc: "Z to A" },
  size: { asc: "Smallest first", desc: "Largest first" },
  updated: { asc: "Oldest first", desc: "Newest first" },
};

export function toRows(
  subfolders: FolderRow[],
  files: FileRow[],
): BrowserRow[] {
  return [
    ...subfolders.map<BrowserRow>((folder) => ({
      childCount: folder.childCount ?? null,
      createdAt: folder.createdAt,
      deleteAt: folder.deleteAt,
      id: folder.id,
      mimeType: null,
      name: folder.name,
      ownerId: null,
      path: folder.path,
      pending: folder.pending === true,
      sizeBytes: null,
      thumbnail: false,
      tier: null,
      type: "folder",
      updatedAt: folder.createdAt,
    })),
    ...files.map<BrowserRow>((file) => ({
      childCount: null,
      createdAt: file.createdAt,
      deleteAt: file.deleteAt,
      id: file.id,
      mimeType: file.mimeType,
      name: file.filename,
      ownerId: file.ownerId ?? null,
      path: file.path,
      pending: file.pending === true,
      sizeBytes: file.sizeBytes,
      thumbnail: file.thumbnail === true,
      tier: file.tier,
      type: "file",
      updatedAt: file.updatedAt,
    })),
  ];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function sortRows(
  rows: BrowserRow[],
  key: SortKey,
  direction: SortDirection,
  foldersFirst = true,
): BrowserRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (foldersFirst && a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (key === "size") {
      return sign * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
    }
    if (key === "updated" || key === "created") {
      const field = key === "updated" ? "updatedAt" : "createdAt";
      return (
        sign * (new Date(a[field]).getTime() - new Date(b[field]).getTime())
      );
    }
    if (key === "kind") {
      const byKind = extensionOf(a.name).localeCompare(extensionOf(b.name));
      if (byKind !== 0) return sign * byKind;
    }
    return sign * a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}
