import { z } from "zod";

import {
  apiResponseSchema,
  cloudDateTimeSchema,
  paginatedResponseSchema,
  paginationSchema,
} from "./common";

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

export const rootFoldersSchema = z.union([
  z.object({
    userRoot: rootFolderSchema,
    sharedRoot: rootFolderSchema,
  }),
  z.object({
    projectRoot: rootFolderSchema,
  }),
]);
export type RootFolders = z.infer<typeof rootFoldersSchema>;
export const rootFoldersResponseSchema = apiResponseSchema(rootFoldersSchema);

export const folderCrumbSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  name: z.string(),
});
export type FolderCrumb = z.infer<typeof folderCrumbSchema>;

export const folderContentsSchema = z.object({
  folder: z.object({
    id: z.uuid(),
    path: z.string(),
    name: z.string(),
    parentId: z.uuid().nullable(),
  }),
  // Root-first chain excluding the folder itself, so a browser can paint
  // breadcrumbs without walking parentId one request per level.
  ancestors: z.array(folderCrumbSchema),
  subfolders: z.array(storageFolderSchema),
  files: z.array(storageFileSchema),
});
export type FolderContents = z.infer<typeof folderContentsSchema>;
export const folderContentsResponseSchema = z.object({
  data: folderContentsSchema,
  pagination: paginationSchema,
});
export const storageFilesResponseSchema =
  paginatedResponseSchema(storageFileSchema);

export const createFolderInputSchema = z.object({
  name: z.string().min(1),
  parentId: z.uuid(),
});
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

export const updateFolderInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    parentId: z.uuid().optional(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "name or parentId is required",
  });
export type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;

export const renamedFolderSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
});
export type RenamedFolder = z.infer<typeof renamedFolderSchema>;
export const renamedFolderResponseSchema =
  apiResponseSchema(renamedFolderSchema);

export const deletedFolderSchema = z.object({
  id: z.uuid(),
  deletedFolders: z.number().int().nonnegative(),
  deletedFiles: z.number().int().nonnegative(),
});
export type DeletedFolder = z.infer<typeof deletedFolderSchema>;
export const deletedFolderResponseSchema =
  apiResponseSchema(deletedFolderSchema);

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
export const updatedFileResponseSchema = apiResponseSchema(updatedFileSchema);
export const storageFileResponseSchema = apiResponseSchema(
  storageFileDetailSchema,
);
export const storageFolderResponseSchema = apiResponseSchema(
  storageFolderDetailSchema,
);

export const createSmbCredentialInputSchema = z.object({
  deviceName: z.string().trim().min(1).max(255),
  expiresAt: cloudDateTimeSchema.nullish(),
});
export type CreateSmbCredentialInput = z.infer<
  typeof createSmbCredentialInputSchema
>;

export const smbCredentialSchema = z.object({
  id: z.uuid(),
  principal: z.string(),
  deviceName: z.string(),
  lastAuthenticatedAt: cloudDateTimeSchema.nullable(),
  lastAuthenticatedFrom: z.string().nullable(),
  expiresAt: cloudDateTimeSchema.nullable(),
  createdAt: cloudDateTimeSchema,
});
export type SmbCredential = z.infer<typeof smbCredentialSchema>;

/** The secret is present on the create response only; it is never stored. */
export const issuedSmbCredentialSchema = smbCredentialSchema.extend({
  secret: z.string(),
});
export type IssuedSmbCredentialResponse = z.infer<
  typeof issuedSmbCredentialSchema
>;
export const smbCredentialListResponseSchema = apiResponseSchema(
  z.array(smbCredentialSchema),
);
export const issuedSmbCredentialResponseSchema = apiResponseSchema(
  issuedSmbCredentialSchema,
);

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
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
export const searchResultsResponseSchema = z.object({
  data: searchResultsSchema,
  pagination: paginationSchema,
});

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
export const shareLinkResponseSchema = apiResponseSchema(shareLinkTokenSchema);

// Deliberately narrower than storageFileSchema: an unauthenticated share page
// gets what it needs to render a preview and nothing that describes the owner,
// the folder it lives in, or where else it is reachable.
export const sharedFileMetaSchema = z.object({
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
});
export type SharedFileMeta = z.infer<typeof sharedFileMetaSchema>;
export const sharedFileMetaResponseSchema =
  apiResponseSchema(sharedFileMetaSchema);

export const downloadArchiveInputSchema = z
  .object({
    fileIds: z.array(z.uuid()).max(1_000).default([]),
    folderIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine(
    ({ fileIds, folderIds }) => fileIds.length > 0 || folderIds.length > 0,
    { message: "At least one file or folder id is required" },
  );
export type DownloadArchiveInput = z.infer<typeof downloadArchiveInputSchema>;

export const archiveJobStateSchema = z.enum(["building", "ready", "failed"]);
export type ArchiveJobState = z.infer<typeof archiveJobStateSchema>;

// The archive is built to disk and then downloaded as a plain file, so the
// client tracks it as a job rather than reading one long response body.
// totalBytes is exact, not an estimate: store-only entries make the output
// size arithmetic.
export const archiveJobSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  fileCount: z.number(),
  totalBytes: z.number(),
  writtenBytes: z.number(),
  state: archiveJobStateSchema,
  error: z.string().nullable(),
});
export type ArchiveJob = z.infer<typeof archiveJobSchema>;
export const archiveJobResponseSchema = apiResponseSchema(archiveJobSchema);

export const tusUploadStatusSchema = z.enum([
  "in_progress",
  "completed",
  "expired",
]);
export type TusUploadStatus = z.infer<typeof tusUploadStatusSchema>;

export const tieringReasonSchema = z.enum([
  "cold",
  "large",
  "watermark",
  "promotion",
  "reconcile",
]);
export type TieringReason = z.infer<typeof tieringReasonSchema>;

export const tieringMoveSchema = z.object({
  fileId: z.uuid(),
  filename: z.string(),
  from: storageTierSchema,
  to: storageTierSchema,
  reason: tieringReasonSchema,
  sizeBytes: z.number().nonnegative(),
});
export type TieringMove = z.infer<typeof tieringMoveSchema>;

export const tieringOrphanSchema = z.object({
  fileId: z.uuid(),
  filename: z.string(),
  path: z.string(),
  sizeBytes: z.number().nonnegative(),
});
export type TieringOrphan = z.infer<typeof tieringOrphanSchema>;

export const tieringReportSchema = z.object({
  dryRun: z.boolean(),
  initialSsdUsagePercent: z.number().nonnegative(),
  finalSsdUsagePercent: z.number().nonnegative(),
  considered: z.number().int().nonnegative(),
  moved: z.array(tieringMoveSchema),
  reconciledCopies: z.number().int().nonnegative(),
  /** Deleted by someone else mid-pass. Expected, not an error. */
  vanished: z.number().int().nonnegative().default(0),
  /** Rows repointed at a blob a crashed pass had already copied. */
  healed: z.number().int().nonnegative().default(0),
  /** Rows deleted because their blob was gone from both tiers. */
  orphaned: z.array(tieringOrphanSchema).default([]),
  failures: z.array(
    z.object({
      fileId: z.uuid(),
      message: z.string(),
    }),
  ),
});
export type TieringReport = z.infer<typeof tieringReportSchema>;
export const tieringReportResponseSchema =
  apiResponseSchema(tieringReportSchema);

export const s3CredentialMetadataSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  accessKeyId: z.string(),
  label: z.string(),
  createdAt: cloudDateTimeSchema,
  lastUsedAt: cloudDateTimeSchema.nullable(),
  revokedAt: cloudDateTimeSchema.nullable(),
});
export type S3CredentialMetadata = z.infer<typeof s3CredentialMetadataSchema>;

export const issuedS3CredentialSchema = s3CredentialMetadataSchema.extend({
  secretAccessKey: z.string(),
});
export type IssuedS3Credential = z.infer<typeof issuedS3CredentialSchema>;
export const s3CredentialsResponseSchema = paginatedResponseSchema(
  s3CredentialMetadataSchema,
);
export const issuedS3CredentialResponseSchema = apiResponseSchema(
  issuedS3CredentialSchema,
);
