import type {
  StorageFile,
  StorageFolder,
  StorageTier,
} from "@repo/schemas/cloud";

export interface BrowserRow {
  type: "file" | "folder";
  id: string;
  name: string;
  /** Folders have no stored size. */
  sizeBytes: number | null;
  updatedAt: string;
  tier: StorageTier | null;
  mimeType: string | null;
}

export type SortKey = "name" | "size" | "updated";
export type SortDirection = "asc" | "desc";

export const SORT_KEYS = ["name", "size", "updated"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  size: "Size",
  updated: "Last modified",
};

export function toRows(
  subfolders: StorageFolder[],
  files: StorageFile[],
): BrowserRow[] {
  return [
    ...subfolders.map<BrowserRow>((folder) => ({
      id: folder.id,
      mimeType: null,
      name: folder.name,
      sizeBytes: null,
      tier: null,
      type: "folder",
      updatedAt: folder.createdAt,
    })),
    ...files.map<BrowserRow>((file) => ({
      id: file.id,
      mimeType: file.mimeType,
      name: file.filename,
      sizeBytes: file.sizeBytes,
      tier: file.tier,
      type: "file",
      updatedAt: file.updatedAt,
    })),
  ];
}

/** Folders always lead, matching every file manager people already use. */
export function sortRows(
  rows: BrowserRow[],
  key: SortKey,
  direction: SortDirection,
): BrowserRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (key === "size") {
      return sign * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
    }
    if (key === "updated") {
      return (
        sign *
        (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      );
    }
    return sign * a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}
