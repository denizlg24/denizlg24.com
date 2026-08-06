export {
  checkStorageAccess,
  type StorageAccessResult,
  type StoragePrincipal,
} from "./access";
export {
  largestFiles,
  storageByType,
  storageByUser,
  storageStats,
  storageUsedByOwner,
} from "./analytics";
export {
  type ArchiveEntry,
  archiveByteLength,
  writeArchive,
} from "./archive";
export {
  type ActiveArchiveJobSnapshot,
  ARCHIVE_JOB_SNAPSHOT_FILENAME,
  type ArchiveJob,
  type ArchiveJobSnapshot,
  type ArchiveJobSnapshotReadResult,
  type ArchiveJobState,
  ArchiveJobStore,
  readArchiveJobSnapshot,
} from "./archive-jobs";
export {
  BRANCH_MARKER_FILENAME,
  readBranchMarkers,
} from "./branch-markers";
export {
  type BranchRoots,
  BranchTieringAgent,
} from "./branch-tiering-agent";
export {
  BROKER_NAMESPACE_WITNESS_NAME,
  type StorageConfig,
  type StorageNamespaceConfig,
  type StorageNamespaceMode,
  storageConfigFromEnv,
} from "./config";
export { contentDisposition } from "./content-disposition";
export {
  computeChecksum,
  copyAndVerify,
  deletePath,
  ensureDir,
  fsyncFile,
  getDiskStats,
  pathExists,
} from "./fs";
export {
  type ChecksumState,
  METADATA_SCHEMA_VERSION,
  PROTECTED_XATTR_KEYS,
  PROTECTED_XATTR_NAMESPACE,
  type ProtectedMetadata,
  protectedCanonicalForm,
  protectedMetadataHash,
} from "./metadata";
export {
  MetadataClientError,
  type MetadataClientOptions,
  NamespaceMetadataClient,
} from "./metadata-client";
export {
  handleMetadataRequest,
  isSupportedProtocolVersion,
  type SmbProvisioningAgent,
  TIER_LOCATE_MAX_PATHS,
  tokenMatches,
} from "./metadata-handler";
export {
  type BranchUsagePayload,
  METADATA_PROTOCOL_VERSION,
  type MetadataEntryPayload,
  type MetadataListingPayload,
  type MetadataRequest,
  type MetadataResponse,
  type TierMoveOutcome,
  type TierMovePayload,
  type TierPlacementPayload,
} from "./metadata-protocol";
export {
  isReservedSegment,
  NamespaceResolveError,
  namespaceSegments,
  type ResolvedEntry,
  resolveNamespacePath,
} from "./metadata-resolve";
export {
  type MetadataFailure,
  MetadataServiceError,
  type NamespaceEntry,
  type NamespaceListing,
  type NamespaceListingProblem,
  NamespaceMetadataService,
} from "./metadata-service";
export {
  createStorageNamespace,
  type StorageNamespace,
  type StorageNamespaceCapabilities,
} from "./namespace";
export {
  type AdoptionAttribution,
  type AdoptionResult,
  adoptEntry,
  ancestorPaths,
  isAdoptable,
} from "./namespace-adoption";
export {
  type AdoptionOutcome,
  type ApplierSource,
  type ApplyOutcome,
  applyWatchedPaths,
} from "./namespace-applier";
export {
  type NamespaceHealth,
  type NamespaceHealthInput,
  type NamespaceHealthStatus,
  namespaceHealth,
} from "./namespace-health";
export { STORAGE_METADATA_HEALTH_KEYS } from "./namespace-health-keys";
export { createProjectionRepository } from "./namespace-projection-repository";
export { indexingProjectionRepository } from "./namespace-projection-search";
export {
  NamespaceProjector,
  type NamespaceSource,
  type ProjectionRepository,
  type ScanOptions,
  type ScanRecord,
  type ScanResult,
} from "./namespace-projector";
export {
  type ProjectedRow,
  planReconciliation,
  type ReapCandidateState,
  type ReconcileInput,
  type ReconcilePlan,
  type ScanCompletionInput,
  scanMayCount,
} from "./namespace-reconcile";
export {
  rebuildStorageSearch,
  type SearchRebuildResult,
  type SearchRebuildSource,
} from "./namespace-search-rebuild";
export { createNamespaceSource } from "./namespace-source";
export {
  type NamespaceSyncEvent,
  type NamespaceSyncOptions,
  NamespaceSyncSupervisor,
} from "./namespace-sync";
export {
  type BranchCopyObservation,
  type DuplicateResolution,
  resolveBranchDuplicate,
  selectDemotions,
  type TierCandidate,
  type TieringBlockedReason,
  type TieringGateInput,
  type TierMove,
  type TierSelectionInput,
  tieringBlockedReason,
} from "./namespace-tiering";
export {
  bytesToFreeFor,
  createNamespaceTieringRepository,
  type NamespaceTieringCandidate,
  type NamespaceTieringOptions,
  type NamespaceTieringRepository,
  runNamespaceTieringPass,
} from "./namespace-tiering-pass";
export {
  type NamespaceWatchMessage,
  watchPathToRelative,
} from "./namespace-watch";
export {
  NamespaceWatcher,
  type WatcherOptions,
  type WatcherSignal,
} from "./namespace-watcher";
export {
  buildProjectRootPath,
  buildUserRootPath,
  isProjectPath,
  isSharedPath,
  joinPath,
  normalizeFileName,
  normalizeName,
  PathValidationError,
  parentPath,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  SHARED_ROOT_PATH,
  sanitizeSegment,
  toSnakeCase,
  validatePath,
  validatePathSegment,
} from "./path";
export * from "./s3";
export {
  type NamingPolicy,
  type StorageEntry,
  StorageService,
  StorageServiceError,
  TUS_VERSION,
} from "./service";
export {
  generateShareToken,
  verifyShareToken,
} from "./share";
export {
  type ParsedAuditEvent,
  parseSmbAuditLine,
  type RecentWriter,
  RecentWriterIndex,
} from "./smb-audit";
export {
  type IssuedSmbCredential,
  issueSmbCredential,
  listSmbCredentials,
  revokeSmbCredential,
  type SafeSmbCredential,
  SMB_MAX_CREDENTIALS_PER_USER,
  type SmbProvisioner,
} from "./smb-credential-service";
export {
  type AccountState,
  deriveSmbPrincipal,
  evaluateSmbAuth,
  generateSmbSecret,
  PROVISION_ORDER,
  REVOKE_ORDER,
  type SmbAuthDecision,
  SmbCredentialError,
  type SmbCredentialRecord,
  smbAuthThrottled,
  type ThrottleInput,
} from "./smb-credentials";
export {
  assertLegacyTieringAllowed,
  createTieringRepository,
  PromotionQueue,
  promoteFile,
  runTieringPass,
  TieringCrashSimulationError,
  type TieringFile,
  type TieringOptions,
  type TieringRepository,
} from "./tiering";
export {
  AttrCommandXattrBackend,
  InMemoryXattrBackend,
  type XattrBackend,
  XattrError,
} from "./xattr";
