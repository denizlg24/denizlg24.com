export interface MetadataServiceConfig {
  /**
   * Physical branch roots, used only to prove they were all mounted for the
   * whole of a projection scan. Empty means the projector can never reap.
   */
  branchPaths: string[];
  /**
   * The two branches by tier role, for the tiering ops. Absent until the host
   * is configured for tiering, and the service then answers UNAVAILABLE rather
   * than guessing a layout — the same shape as SMB provisioning.
   */
  branchRoots: { ssd: string; hdd: string } | null;
  namespaceRoot: string;
  /** Absent when this host does not provision SMB accounts. */
  smbScriptPath: string | null;
  socketGid: number;
  /** Distinct pending paths tolerated before the watcher declares overflow. */
  watchMaxPending: number;
  /** How long a path must stop changing before it is reported. */
  watchQuietMs: number;
  socketPath: string;
  token: string;
  witnessPath: string;
  witnessValue: string;
}

function boundedInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The service refuses to start without a witness, because the failure it is
 * guarding against is starting against an unmounted namespace: an empty host
 * directory would let it answer NOT_FOUND for every entry, which a projector
 * could read as mass deletion.
 */
export function configFromEnv(): MetadataServiceConfig {
  const namespaceRoot = required("STORAGE_NAMESPACE_ROOT");
  if (!namespaceRoot.startsWith("/")) {
    throw new Error("STORAGE_NAMESPACE_ROOT must be absolute");
  }
  const socketPath = required("STORAGE_METADATA_SOCKET");
  if (!socketPath.startsWith("/")) {
    throw new Error("STORAGE_METADATA_SOCKET must be absolute");
  }
  const token = required("STORAGE_METADATA_TOKEN");
  if (token.length < 16) {
    throw new Error("STORAGE_METADATA_TOKEN must be at least 16 characters");
  }
  const rawGid = process.env.STORAGE_METADATA_SOCKET_GID ?? "1000";
  const socketGid = Number(rawGid);
  if (!Number.isInteger(socketGid) || socketGid < 0) {
    throw new Error(
      "STORAGE_METADATA_SOCKET_GID must be a non-negative integer",
    );
  }
  const smbScriptPath = process.env.STORAGE_SMB_SCRIPT?.trim() ?? null;
  if (smbScriptPath && !smbScriptPath.startsWith("/")) {
    throw new Error("STORAGE_SMB_SCRIPT must be an absolute path");
  }
  const branchPaths = (process.env.STORAGE_BRANCH_PATHS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  for (const branchPath of branchPaths) {
    if (!branchPath.startsWith("/")) {
      throw new Error("STORAGE_BRANCH_PATHS entries must be absolute paths");
    }
    // A branch inside the namespace would be the union mount reading itself:
    // the same entries would appear under two roots and the marker would not
    // describe a physical disk.
    if (
      branchPath === namespaceRoot ||
      branchPath.startsWith(`${namespaceRoot}/`)
    ) {
      throw new Error(
        "STORAGE_BRANCH_PATHS entries must be outside the namespace root",
      );
    }
  }
  const ssdBranch = process.env.STORAGE_SSD_BRANCH_PATH?.trim();
  const hddBranch = process.env.STORAGE_HDD_BRANCH_PATH?.trim();
  if (Boolean(ssdBranch) !== Boolean(hddBranch)) {
    throw new Error(
      "STORAGE_SSD_BRANCH_PATH and STORAGE_HDD_BRANCH_PATH must be set together",
    );
  }
  for (const branchPath of [ssdBranch, hddBranch]) {
    if (!branchPath) continue;
    if (!branchPath.startsWith("/")) {
      throw new Error("Branch role paths must be absolute");
    }
    // Same reason as STORAGE_BRANCH_PATHS: a role pointed at the union mount
    // would make every tier move copy a file onto itself through FUSE.
    if (
      branchPath === namespaceRoot ||
      branchPath.startsWith(`${namespaceRoot}/`)
    ) {
      throw new Error("Branch role paths must be outside the namespace root");
    }
  }
  if (ssdBranch && ssdBranch === hddBranch) {
    throw new Error(
      "STORAGE_SSD_BRANCH_PATH and STORAGE_HDD_BRANCH_PATH must differ",
    );
  }

  return {
    branchPaths,
    branchRoots:
      ssdBranch && hddBranch ? { hdd: hddBranch, ssd: ssdBranch } : null,
    namespaceRoot,
    watchMaxPending: boundedInt(
      "STORAGE_WATCH_MAX_PENDING",
      5_000,
      1,
      1_000_000,
    ),
    watchQuietMs: boundedInt("STORAGE_WATCH_QUIET_MS", 400, 50, 60_000),
    smbScriptPath,
    socketGid,
    socketPath,
    token,
    witnessPath: required("STORAGE_NAMESPACE_WITNESS_PATH_HOST"),
    witnessValue: required("STORAGE_NAMESPACE_WITNESS_VALUE"),
  };
}
