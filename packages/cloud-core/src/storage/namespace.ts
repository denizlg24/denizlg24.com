import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path/posix";

import type { StorageFile, StorageTier } from "../db/schema";
import {
  BROKER_NAMESPACE_WITNESS_NAME,
  type StorageConfig,
  type StorageNamespaceMode,
} from "./config";
import { ensureDir } from "./fs";
import {
  PathValidationError,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  validatePath,
} from "./path";

export interface StorageNamespaceCapabilities {
  /** Protected xattrs require the later native adapter and are not claimed here. */
  protectedXattrs: false;
  /** The legacy mover cannot interpret broker-view `diskPath` values. */
  directBranchTiering: boolean;
  /** Broker placement is not observable through the request mount. */
  authoritativePhysicalTier: boolean;
}

export interface StorageNamespace {
  readonly mode: StorageNamespaceMode;
  readonly capabilities: StorageNamespaceCapabilities;
  /** Root visible to REST/WebDAV in broker mode; null in the old layout. */
  readonly requestRootPath: string | null;
  /** True when every tier is reached through the same logical tree. */
  readonly usesSingleRequestTree: boolean;
  initialize(): Promise<void>;
  resolveFolderPath(path: string): string;
  resolveFilePath(
    file: Pick<StorageFile, "diskPath" | "id" | "path" | "tier">,
  ): string;
  resolveNewFilePath(path: string, tier: StorageTier, fileId: string): string;
}

function logicalPath(rootPath: string, path: string): string {
  validatePath(path);
  if (path === `/${BROKER_NAMESPACE_WITNESS_NAME}`) {
    throw new PathValidationError(
      "Broker mount witness is outside the user namespace",
    );
  }
  return join(rootPath, path);
}

class LegacyStorageNamespace implements StorageNamespace {
  readonly mode = "legacy-dual-path" as const;
  readonly capabilities = {
    protectedXattrs: false,
    directBranchTiering: true,
    authoritativePhysicalTier: true,
  } as const;
  readonly requestRootPath = null;
  readonly usesSingleRequestTree = false;

  constructor(private readonly config: StorageConfig) {}

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.config.ssdStoragePath),
      ensureDir(this.config.hddStoragePath),
    ]);
  }

  resolveFolderPath(path: string): string {
    validatePath(path);
    return resolveSsdDiskPath(this.config.ssdStoragePath, path);
  }

  resolveFilePath(
    file: Pick<StorageFile, "diskPath" | "id" | "path" | "tier">,
  ): string {
    validatePath(file.path);
    return file.diskPath;
  }

  resolveNewFilePath(path: string, tier: StorageTier, fileId: string): string {
    validatePath(path);
    return tier === "ssd"
      ? resolveSsdDiskPath(this.config.ssdStoragePath, path)
      : resolveHddDiskPath(this.config.hddStoragePath, fileId);
  }
}

class BrokerMountedStorageNamespace implements StorageNamespace {
  readonly mode = "broker-mounted" as const;
  readonly capabilities = {
    protectedXattrs: false,
    directBranchTiering: false,
    authoritativePhysicalTier: false,
  } as const;
  readonly usesSingleRequestTree = true;
  readonly requestRootPath: string;
  readonly #witnessPath: string;
  readonly #witnessValue: string;

  constructor(config: StorageConfig) {
    if (config.namespace.mode !== "broker-mounted") {
      throw new Error("Broker namespace requires broker-mounted configuration");
    }
    this.requestRootPath = config.namespace.rootPath;
    this.#witnessPath = config.namespace.witnessPath;
    this.#witnessValue = config.namespace.witnessValue;
  }

  async initialize(): Promise<void> {
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(this.requestRootPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error(
          `Broker-mounted storage namespace is unavailable: ${this.requestRootPath}`,
        );
      }
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `Broker-mounted storage namespace must be an existing non-symlink directory: ${this.requestRootPath}`,
      );
    }

    let witnessStats: Awaited<ReturnType<typeof lstat>>;
    let witnessValue: string;
    try {
      [witnessStats, witnessValue] = await Promise.all([
        lstat(this.#witnessPath),
        readFile(this.#witnessPath, "utf8"),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error(
          `Broker-mounted storage witness is unavailable: ${this.#witnessPath}`,
        );
      }
      throw error;
    }
    if (!witnessStats.isFile() || witnessStats.isSymbolicLink()) {
      throw new Error(
        `Broker-mounted storage witness must be a regular non-symlink file: ${this.#witnessPath}`,
      );
    }
    if (witnessValue.trimEnd() !== this.#witnessValue) {
      throw new Error("Broker-mounted storage witness value does not match");
    }
  }

  resolveFolderPath(path: string): string {
    return logicalPath(this.requestRootPath, path);
  }

  resolveFilePath(
    file: Pick<StorageFile, "diskPath" | "id" | "path" | "tier">,
  ): string {
    return logicalPath(this.requestRootPath, file.path);
  }

  resolveNewFilePath(
    path: string,
    _tier: StorageTier,
    _fileId: string,
  ): string {
    return logicalPath(this.requestRootPath, path);
  }
}

export function createStorageNamespace(
  config: StorageConfig,
): StorageNamespace {
  return config.namespace.mode === "broker-mounted"
    ? new BrokerMountedStorageNamespace(config)
    : new LegacyStorageNamespace(config);
}
