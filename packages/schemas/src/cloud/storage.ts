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
  /** Who added it. Optional until every producer carries it; listings do. */
  ownerId: z.uuid().optional(),
  /** The kind can be drawn as itself, so a tile may ask for a thumbnail. */
  thumbnail: z.boolean().optional(),
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

export const folderChildCountSchema = z.object({
  folders: z.number().int(),
  files: z.number().int(),
});
export type FolderChildCount = z.infer<typeof folderChildCountSchema>;

export const storageFolderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  path: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: cloudDateTimeSchema,
  /** Direct children only. Present on listings; a detail row may omit it. */
  childCount: folderChildCountSchema.optional(),
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

export const recentFileSchema = storageFileSchema.extend({
  folder: z.object({ id: z.uuid(), name: z.string() }),
});
export type RecentFile = z.infer<typeof recentFileSchema>;
export const recentFilesResponseSchema = apiResponseSchema(
  z.array(recentFileSchema),
);

export const storagePersonSchema = z.object({
  id: z.uuid(),
  username: z.string(),
});
export type StoragePerson = z.infer<typeof storagePersonSchema>;

export const storageUsageSchema = z.object({
  personalBytes: z.number().nonnegative(),
  familyBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
});
export type StorageUsage = z.infer<typeof storageUsageSchema>;

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
  /** A session is open on the host right now. Optional so an older API still parses. */
  connected: z.boolean().optional(),
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

export const sharePasswordSchema = z.string().min(4).max(128);

export const createShareLinkInputSchema = z.object({
  expiresIn: shareExpiresInSchema,
  /** Locks the link; recipients type it once and get a cookie for the share. */
  password: sharePasswordSchema.nullish(),
  /** False makes the link view-only: inline previews, no download links. A courtesy, not DRM. */
  allowDownload: z.boolean().optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

export const updateShareInputSchema = z.object({
  expiresIn: shareExpiresInSchema.optional(),
  /** A string sets a new password, null removes it, absent leaves it. */
  password: sharePasswordSchema.nullish(),
  allowDownload: z.boolean().optional(),
  /** True stops sharing; the link answers "no longer works" from then on. */
  revoke: z.boolean().optional(),
  /**
   * True mints a new token for the same share and answers it; the old link
   * stops working. Only the hash is ever stored, so this is the one way to
   * get a link back for a share whose token this browser never saw.
   */
  rotate: z.boolean().optional(),
});
export type UpdateShareInput = z.infer<typeof updateShareInputSchema>;

export const shareKindSchema = z.enum(["file", "folder"]);
export const shareStatusSchema = z.enum(["active", "expired", "revoked"]);

export const storageShareSchema = z.object({
  id: z.uuid(),
  kind: shareKindSchema,
  targetId: z.uuid(),
  /** The target's current name, or the name it had when it was deleted. */
  name: z.string(),
  ownerId: z.uuid(),
  ownerUsername: z.string().optional(),
  expiresAt: cloudDateTimeSchema.nullable(),
  hasPassword: z.boolean(),
  allowDownload: z.boolean(),
  status: shareStatusSchema,
  createdAt: cloudDateTimeSchema,
  revokedAt: cloudDateTimeSchema.nullable(),
  lastAccessedAt: cloudDateTimeSchema.nullable(),
  accessCount: z.number().int().nonnegative(),
  /** The target no longer exists; the link answers "no longer works". */
  targetMissing: z.boolean(),
});
export type StorageShare = z.infer<typeof storageShareSchema>;
export const storageSharesResponseSchema = apiResponseSchema(
  z.array(storageShareSchema),
);
export const storageShareResponseSchema = apiResponseSchema(storageShareSchema);

export const updatedShareSchema = z.object({
  share: storageShareSchema,
  /** Present when the update rotated the token. */
  token: z.string().optional(),
});
export type UpdatedShare = z.infer<typeof updatedShareSchema>;

export const shareLinkTokenSchema = z.object({
  token: z.string(),
  /** Present for stateful links; a legacy HMAC token carries no row. */
  share: storageShareSchema.optional(),
});
export type ShareLinkToken = z.infer<typeof shareLinkTokenSchema>;
export const shareLinkResponseSchema = apiResponseSchema(shareLinkTokenSchema);

/**
 * What a recipient learns before anything else. Deliberately narrower than
 * the owner's view: the sharer's username and the item's name are the whole
 * of it until a password share is unlocked, and never the path, the owner
 * id or where else the item is reachable.
 */
export const sharedMetaSchema = z.object({
  kind: shareKindSchema,
  name: z.string(),
  sharer: z.object({ username: z.string() }),
  requiresPassword: z.boolean(),
  /** False while a password share is still locked for this browser. */
  unlocked: z.boolean(),
  expiresAt: cloudDateTimeSchema.nullable(),
  allowDownload: z.boolean(),
  /** File shares only. */
  fileId: z.uuid().optional(),
  mimeType: z.string().nullable().optional(),
  sizeBytes: z.number().optional(),
  updatedAt: cloudDateTimeSchema.optional(),
  thumbnail: z.boolean().optional(),
  /** Folder shares only. */
  folderId: z.uuid().optional(),
  itemCount: z.number().int().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
});
export type SharedMeta = z.infer<typeof sharedMetaSchema>;
export const sharedMetaResponseSchema = apiResponseSchema(sharedMetaSchema);

/** The legacy shape, kept for clients built against it. */
export const sharedFileMetaSchema = z.object({
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
});
export type SharedFileMeta = z.infer<typeof sharedFileMetaSchema>;
export const sharedFileMetaResponseSchema =
  apiResponseSchema(sharedFileMetaSchema);

export const unlockShareInputSchema = z.object({
  password: z.string().min(1).max(128),
});
export type UnlockShareInput = z.infer<typeof unlockShareInputSchema>;

/** A file as a share recipient sees it: no path, no owner. */
export const sharedFileSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
  updatedAt: cloudDateTimeSchema,
  thumbnail: z.boolean(),
});
export type SharedFile = z.infer<typeof sharedFileSchema>;

export const sharedFolderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  childCount: folderChildCountSchema,
});

export const sharedContentsSchema = z.object({
  folder: z.object({ id: z.uuid(), name: z.string() }),
  /** Root-first, starting at the shared folder and excluding the current one. */
  ancestors: z.array(z.object({ id: z.uuid(), name: z.string() })),
  subfolders: z.array(sharedFolderSchema),
  files: z.array(sharedFileSchema),
});
export type SharedContents = z.infer<typeof sharedContentsSchema>;
export const sharedContentsResponseSchema = z.object({
  data: sharedContentsSchema,
  pagination: paginationSchema,
});

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

/**
 * Why a broker-mode pass did nothing. A blocked pass is a success — the gate
 * exists to stop bytes moving on an untrustworthy picture of the namespace —
 * so the reason has to survive into the report rather than into an error.
 */
export const namespaceTieringBlockSchema = z.enum([
  "namespace-not-mounted",
  "branch-marker-invalid",
  "projection-dirty",
  "backup-restore-active",
  "migration-mode",
  "branch-usage-unavailable",
  /**
   * The privileged service rejected the request rather than failing it — it
   * predates these ops. Distinct from a mount problem on purpose: the symptom
   * of deploying the API ahead of the hand-installed host binary is otherwise
   * an operator investigating a healthy mount.
   */
  "metadata-protocol-rejected",
]);
export type NamespaceTieringBlock = z.infer<typeof namespaceTieringBlockSchema>;

/**
 * What the privileged service reported for one path it was asked to move.
 * Everything except `moved` leaves both branches exactly as they were.
 */
export const namespaceTierMoveOutcomeSchema = z.enum([
  "moved",
  /** Already on the destination branch; the projection was simply stale. */
  "already-placed",
  /** Gone, or no longer the entry whose identity the API asked for. */
  "vanished",
  /** Present on both branches and the copies disagree. Alerts, never resolves. */
  "quarantined",
  /** Refused by the gate on the privileged side, e.g. an open SMB handle. */
  "deferred",
]);
export type NamespaceTierMoveOutcome = z.infer<
  typeof namespaceTierMoveOutcomeSchema
>;

/**
 * A move the pass intends to attempt. Deliberately has no `outcome`: a plan
 * that can report one invites a consumer to count unattempted moves as
 * relocated bytes.
 */
export const namespaceTierPlanSchema = z.object({
  fileId: z.uuid(),
  relativePath: z.string(),
  from: storageTierSchema,
  to: storageTierSchema,
  sizeBytes: z.number().nonnegative(),
  /**
   * Which rule named this file. `watermark` means no rule did — it is being
   * moved only because the SSD is still above its target, which is the one
   * reason that can reach the target when age and size run out of candidates.
   *
   * Not `reason`: the applied move below carries one of those already, for why
   * an outcome was not `moved`. A plan reason and a refusal reason are different
   * questions and a single field would answer neither reliably.
   */
  planReason: tieringReasonSchema,
});
export type NamespaceTierPlan = z.infer<typeof namespaceTierPlanSchema>;

export const namespaceTierMoveSchema = namespaceTierPlanSchema.extend({
  outcome: namespaceTierMoveOutcomeSchema,
  /**
   * Where the bytes actually were. Null when the privileged service could not
   * say — an unmounted branch, or an entry that had already vanished. It is
   * not always the `from` the plan assumed: `already-placed` means the source
   * was on the destination all along.
   */
  observedFrom: storageTierSchema.nullable(),
  /** Why a non-`moved` outcome happened. Null for a clean move. */
  reason: z.string().nullable(),
});
export type NamespaceTierMove = z.infer<typeof namespaceTierMoveSchema>;

export const branchUsageSchema = z.object({
  tier: storageTierSchema,
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  usagePercent: z.number().nonnegative(),
});
export type BranchUsage = z.infer<typeof branchUsageSchema>;

export const namespaceTieringReportSchema = z.object({
  dryRun: z.boolean(),
  /** Non-null means nothing was attempted; every other count is then zero. */
  blockedBy: namespaceTieringBlockSchema.nullable(),
  ssd: branchUsageSchema.nullable(),
  hdd: branchUsageSchema.nullable(),
  /** Projection rows the policy judged eligible before placement was checked. */
  eligible: z.number().int().nonnegative(),
  /** Of those, the ones the privileged service confirmed were on the SSD. */
  onSsd: z.number().int().nonnegative(),
  /**
   * Of those, the ones carrying a checksum, which is what a move verifies the
   * copy against. Reported because it is the difference between "nothing needs
   * moving" and "nothing *can* move until the checksum backfill catches up",
   * and the counts either side of it look identical without it.
   */
  verified: z.number().int().nonnegative(),
  bytesToFree: z.number().nonnegative(),
  planned: z.array(namespaceTierPlanSchema),
  applied: z.array(namespaceTierMoveSchema),
  quarantined: z.array(
    z.object({ relativePath: z.string(), reason: z.string() }),
  ),
  failures: z.array(
    z.object({ relativePath: z.string(), message: z.string() }),
  ),
});
export type NamespaceTieringReport = z.infer<
  typeof namespaceTieringReportSchema
>;
export const namespaceTieringReportResponseSchema = apiResponseSchema(
  namespaceTieringReportSchema,
);

/**
 * The same report as it survives in `task_runs.metadata`, which is read back
 * long after it was written. `verified` and `planReason` were added to runs
 * that had already happened, and those rows genuinely do not carry them —
 * defaulting either would put an invented count and an invented rule in front
 * of a real past run, and the strict shape rejects the row outright.
 *
 * Only history is lenient. Anything producing a report still owes the full
 * shape above, so a new writer cannot quietly drop a field.
 */
export const storedNamespaceTieringReportSchema =
  namespaceTieringReportSchema.extend({
    verified: z.number().int().nonnegative().optional(),
    planned: z.array(namespaceTierPlanSchema.partial({ planReason: true })),
    applied: z.array(namespaceTierMoveSchema.partial({ planReason: true })),
  });
export type StoredNamespaceTieringReport = z.infer<
  typeof storedNamespaceTieringReportSchema
>;

/**
 * Why a backfill run did nothing. Unlike the tiering gate this is a short list:
 * the pass only reads bytes, so a dirty projection is not a reason to withhold
 * it — a stale path simply hashes nothing and is reported as skipped.
 */
export const checksumBackfillBlockSchema = z.enum([
  "migration-mode",
  "backup-restore-active",
  /** The socket went away mid-run; whatever was stamped before it stands. */
  "metadata-unavailable",
]);
export type ChecksumBackfillBlock = z.infer<typeof checksumBackfillBlockSchema>;

export const checksumBackfillReportSchema = z.object({
  dryRun: z.boolean(),
  blockedBy: checksumBackfillBlockSchema.nullable(),
  /** Rows carrying no checksum when the run started. */
  pending: z.number().int().nonnegative(),
  hashed: z.number().int().nonnegative(),
  bytesHashed: z.number().nonnegative(),
  /** Still unverified afterwards, counted again rather than subtracted. */
  remaining: z.number().int().nonnegative(),
  /** Which budget ended the run, or null when it ran out of work instead. */
  exhausted: z.enum(["files", "bytes", "time"]).nullable(),
  skipped: z.array(
    z.object({
      relativePath: z.string(),
      reason: z.enum(["missing", "identity-changed"]),
    }),
  ),
  failures: z.array(
    z.object({ relativePath: z.string(), message: z.string() }),
  ),
});
export type ChecksumBackfillReport = z.infer<
  typeof checksumBackfillReportSchema
>;

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
