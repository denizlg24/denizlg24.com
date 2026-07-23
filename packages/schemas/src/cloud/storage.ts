import { z } from "zod";

import { cloudDateTimeSchema, paginationSchema } from "./common";

export const storageTierSchema = z.enum(["ssd", "hdd"]);
export type StorageTier = z.infer<typeof storageTierSchema>;

export const storageFileSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  path: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
  tier: storageTierSchema,
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type StorageFile = z.infer<typeof storageFileSchema>;

export const storageFileDetailSchema = storageFileSchema.extend({
  checksum: z.string(),
  lastAccessedAt: cloudDateTimeSchema.nullable(),
  accessCount: z.number().int(),
});
export type StorageFileDetail = z.infer<typeof storageFileDetailSchema>;

export const storageFolderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  path: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: cloudDateTimeSchema,
});
export type StorageFolder = z.infer<typeof storageFolderSchema>;

export const storageFolderDetailSchema = storageFolderSchema.extend({
  ownerId: z.uuid(),
  updatedAt: cloudDateTimeSchema,
});
export type StorageFolderDetail = z.infer<typeof storageFolderDetailSchema>;

const rootFolderSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  name: z.string(),
});

export const rootFoldersSchema = z.object({
  userRoot: rootFolderSchema,
  sharedRoot: rootFolderSchema,
});
export type RootFolders = z.infer<typeof rootFoldersSchema>;

export const folderContentsSchema = z.object({
  folder: z.object({
    id: z.uuid(),
    path: z.string(),
    name: z.string(),
    parentId: z.uuid().nullable(),
  }),
  subfolders: z.array(storageFolderSchema),
  files: z.array(storageFileSchema),
  pagination: paginationSchema,
});
export type FolderContents = z.infer<typeof folderContentsSchema>;

export const createFolderInputSchema = z.object({
  name: z.string().min(1),
  parentId: z.uuid(),
});
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

export const renameFolderInputSchema = z.object({
  name: z.string().min(1),
});
export type RenameFolderInput = z.infer<typeof renameFolderInputSchema>;

export const renamedFolderSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
});
export type RenamedFolder = z.infer<typeof renamedFolderSchema>;

export const updateFileInputSchema = z
  .object({
    filename: z.string().min(1).optional(),
    folderId: z.uuid().optional(),
  })
  .refine(
    (value) => value.filename !== undefined || value.folderId !== undefined,
    {
      message: "filename or folderId is required",
    },
  );
export type UpdateFileInput = z.infer<typeof updateFileInputSchema>;

export const updatedFileSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  path: z.string(),
  folderId: z.uuid(),
});
export type UpdatedFile = z.infer<typeof updatedFileSchema>;

export const searchHitSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "folder"]),
  ownerId: z.string(),
  scope: z.enum(["user", "shared"]),
  mimeType: z.string().nullable().optional(),
  sizeBytes: z.number().optional(),
  tier: storageTierSchema.optional(),
  folderId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultsSchema = z.object({
  hits: z.array(searchHitSchema),
  pagination: paginationSchema,
});
export type SearchResults = z.infer<typeof searchResultsSchema>;

export const shareExpiresInSchema = z.enum(["30m", "1d", "7d", "30d", "never"]);
export type ShareExpiresIn = z.infer<typeof shareExpiresInSchema>;

export const createShareLinkInputSchema = z.object({
  expiresIn: shareExpiresInSchema,
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

export const shareLinkTokenSchema = z.object({
  token: z.string(),
});
export type ShareLinkToken = z.infer<typeof shareLinkTokenSchema>;
