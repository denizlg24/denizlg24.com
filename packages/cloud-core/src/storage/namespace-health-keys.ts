/**
 * Metric names the projector publishes. Named centrally so an ops dashboard and
 * an alert rule cannot disagree about a series' spelling.
 */
export const STORAGE_METADATA_HEALTH_KEYS = {
  branchesValid: "namespace.branches_valid",
  dirtyAgeSeconds: "namespace.projection_dirty_age_seconds",
  filesProjected: "namespace.files_projected",
  foldersProjected: "namespace.folders_projected",
  lastCompleteAgeSeconds: "namespace.last_complete_scan_age_seconds",
  metadataReachable: "namespace.metadata_service_reachable",
  reapCandidates: "namespace.reap_candidates",
  scanDurationSeconds: "namespace.scan_duration_seconds",
  unrepairedProblems: "namespace.unrepaired_projection_errors",
  watcherOverflows: "namespace.watcher_overflows",
} as const;
