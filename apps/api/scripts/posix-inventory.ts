import { createHash } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  statfs,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  createDb,
  type Database,
  files,
  folders,
  readArchiveJobSnapshot,
  requiredEnv,
  tusUploads,
} from "@repo/cloud-core";
import { eq } from "drizzle-orm";

import { runScript, ScriptError } from "./lib/runner";

/**
 * Read-only preflight for Cloud 014. PostgreSQL remains authoritative at this
 * checkpoint, so logical-path checks use its rows while physical checks inspect
 * both configured branches without following links or opening anything for
 * writing. The only write is the operator-owned JSONL audit artifact.
 */

const CHECKSUM_BUFFER_BYTES = 1024 * 1024;
const MAX_AUDIT_RECORDS = 10_000;
const SHA256 = /^[0-9a-f]{64}$/i;
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface InventoryFileRow {
  checksum: string;
  diskPath: string;
  filename: string;
  id: string;
  path: string;
  sizeBytes: number;
  tier: "ssd" | "hdd";
}

export interface InventoryFolderRow {
  id: string;
  name: string;
  path: string;
}

export interface InventoryTusRow {
  bytesReceived: number;
  expiresAt: Date;
  id: string;
  sizeBytes: number;
}

export interface AuditRecord {
  [key: string]: unknown;
  event: string;
}

export interface PosixInventoryOptions {
  archivePath: string;
  auditPath: string;
  db: Database;
  excludedPaths?: readonly string[];
  hddStoragePath: string;
  now?: Date;
  requireMountPoints?: boolean;
  ssdStoragePath: string;
}

interface TierTotals {
  bytes: number;
  files: number;
}

interface BranchScan {
  directories: number;
  excludedRoots: number;
  hardLinks: number;
  orphanFiles: number;
  regularFiles: number;
  scanErrors: number;
  specialFiles: number;
  symlinks: number;
}

function addAudit(
  records: AuditRecord[],
  event: string,
  fields: Record<string, unknown>,
): void {
  if (records.length < MAX_AUDIT_RECORDS) {
    records.push({ at: new Date().toISOString(), event, ...fields });
  }
}

function invalidNameReasons(name: string): string[] {
  const reasons: string[] = [];
  if (!name || name === "." || name === "..") reasons.push("empty-or-dot");
  if (/[. ]$/.test(name)) reasons.push("trailing-dot-or-space");
  if (/[\\/]/.test(name)) reasons.push("separator");
  if (
    [...name].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    reasons.push("control-character");
  }
  if (WINDOWS_RESERVED_NAME.test(name)) reasons.push("windows-reserved");
  if (name !== name.normalize("NFC")) reasons.push("not-nfc");
  if (Buffer.byteLength(name, "utf8") > 255) reasons.push("over-255-bytes");
  return reasons;
}

/** Conservative provisional fold; Gate 1 locks the client-tested algorithm. */
export function crossPlatformNameKey(name: string): string {
  return name.normalize("NFKC").toUpperCase();
}

function logicalEntryChecks(
  fileRows: readonly InventoryFileRow[],
  folderRows: readonly InventoryFolderRow[],
  records: AuditRecord[],
): {
  casefoldCollisions: number;
  duplicateIds: number;
  duplicatePaths: number;
  invalidNames: number;
} {
  const entries = [
    ...folderRows.map((row) => ({
      id: row.id,
      kind: "folder" as const,
      name: row.name,
      path: row.path,
    })),
    ...fileRows.map((row) => ({
      id: row.id,
      kind: "file" as const,
      name: row.filename,
      path: row.path,
    })),
  ];
  const byId = new Map<string, typeof entries>();
  const byPath = new Map<string, typeof entries>();
  const byCasefold = new Map<string, typeof entries>();
  let invalidNames = 0;

  for (const entry of entries) {
    const reasons = invalidNameReasons(entry.name);
    const rawSegments = entry.path.split("/");
    const segments = rawSegments.filter(Boolean);
    for (const segment of segments) {
      for (const reason of invalidNameReasons(segment)) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
    if (
      !entry.path.startsWith("/") ||
      entry.path === "/" ||
      entry.path.endsWith("/") ||
      entry.path.includes("//") ||
      segments.includes(".") ||
      segments.includes("..")
    ) {
      reasons.push("invalid-logical-path");
    }
    if (posix.basename(entry.path) !== entry.name) {
      reasons.push("name-path-mismatch");
    }
    if (reasons.length > 0) {
      invalidNames += 1;
      addAudit(records, "invalid-name", {
        entryId: entry.id,
        entryKind: entry.kind,
        logicalPath: entry.path,
        reasons,
      });
    }

    const ids = byId.get(entry.id) ?? [];
    ids.push(entry);
    byId.set(entry.id, ids);
    const paths = byPath.get(entry.path) ?? [];
    paths.push(entry);
    byPath.set(entry.path, paths);
    const parent = posix.dirname(entry.path);
    const key = `${parent}\0${crossPlatformNameKey(entry.name)}`;
    const folded = byCasefold.get(key) ?? [];
    folded.push(entry);
    byCasefold.set(key, folded);
  }

  let duplicateIds = 0;
  for (const [id, matches] of byId) {
    if (matches.length < 2) continue;
    duplicateIds += 1;
    addAudit(records, "duplicate-id", {
      entryId: id,
      entries: matches.map(({ kind, path }) => ({ kind, logicalPath: path })),
    });
  }

  let duplicatePaths = 0;
  for (const [path, matches] of byPath) {
    if (matches.length < 2) continue;
    duplicatePaths += 1;
    addAudit(records, "duplicate-logical-path", {
      entries: matches.map(({ id, kind }) => ({ entryId: id, kind })),
      logicalPath: path,
    });
  }

  let casefoldCollisions = 0;
  for (const matches of byCasefold.values()) {
    const distinctPaths = new Set(matches.map(({ path }) => path));
    if (matches.length < 2 || distinctPaths.size < 2) continue;
    casefoldCollisions += 1;
    addAudit(records, "casefold-collision", {
      entries: matches.map(({ id, kind, path }) => ({
        entryId: id,
        kind,
        logicalPath: path,
      })),
      parentPath: posix.dirname(matches[0]?.path ?? "/"),
    });
  }

  return { casefoldCollisions, duplicateIds, duplicatePaths, invalidNames };
}

function pathInside(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return (
    remainder !== "" &&
    remainder !== ".." &&
    !remainder.startsWith(`..${sep}`) &&
    !isAbsolute(remainder)
  );
}

function pathAtOrInside(root: string, candidate: string): boolean {
  return (
    resolve(root) === resolve(candidate) ||
    pathInside(resolve(root), resolve(candidate))
  );
}

export function resolveStoredBlobPath(
  root: string,
  diskPath: string,
): string | null {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, diskPath);
  return pathInside(resolvedRoot, candidate) ? candidate : null;
}

export function expectedLegacyBlobPath(
  root: string,
  row: Pick<InventoryFileRow, "id" | "path" | "tier">,
): string {
  return row.tier === "ssd"
    ? resolve(root, `.${row.path}`)
    : resolve(root, row.id);
}

async function checksumHandle(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHECKSUM_BUFFER_BYTES);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

async function verifyBlobs(
  rows: readonly InventoryFileRow[],
  roots: Record<"hdd" | "ssd", string>,
  records: AuditRecord[],
): Promise<{
  blobReadErrors: number;
  checksumMismatches: number;
  duplicateDiskPaths: number;
  malformedChecksums: number;
  missingBlobs: number;
  nonRegularBlobs: number;
  outOfRootDiskPaths: number;
  sizeMismatches: number;
  verifiedBlobs: number;
  wrongDiskPaths: number;
}> {
  let blobReadErrors = 0;
  let checksumMismatches = 0;
  let duplicateDiskPaths = 0;
  let malformedChecksums = 0;
  let missingBlobs = 0;
  let nonRegularBlobs = 0;
  let outOfRootDiskPaths = 0;
  let sizeMismatches = 0;
  let verifiedBlobs = 0;
  let wrongDiskPaths = 0;
  const physicalPaths = new Map<string, InventoryFileRow>();
  const canonicalRoots = {
    hdd: await realpath(roots.hdd).catch(() => roots.hdd),
    ssd: await realpath(roots.ssd).catch(() => roots.ssd),
  };

  for (const row of rows) {
    const path = resolveStoredBlobPath(roots[row.tier], row.diskPath);
    if (!path) {
      outOfRootDiskPaths += 1;
      addAudit(records, "blob-outside-tier-root", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    }
    const expected = expectedLegacyBlobPath(roots[row.tier], row);
    if (!isAbsolute(row.diskPath) || resolve(row.diskPath) !== expected) {
      wrongDiskPaths += 1;
      addAudit(records, "wrong-disk-path", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    }
    const prior = physicalPaths.get(path);
    if (prior) {
      duplicateDiskPaths += 1;
      addAudit(records, "duplicate-disk-path", {
        entryIds: [prior.id, row.id],
        logicalPaths: [prior.path, row.path],
        tier: row.tier,
      });
      continue;
    }
    physicalPaths.set(path, row);
    if (!SHA256.test(row.checksum)) {
      malformedChecksums += 1;
      addAudit(records, "malformed-checksum", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    }
    let stats: Stats | null;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      const parent = dirname(path);
      const canonicalParent = await realpath(parent);
      const expectedCanonicalParent = resolve(
        canonicalRoots[row.tier],
        relative(roots[row.tier], parent),
      );
      if (canonicalParent !== expectedCanonicalParent) {
        throw Object.assign(new Error("intermediate symlink"), {
          code: "ELOOP",
        });
      }
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      stats = await handle.stat();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        stats = null;
      } else {
        blobReadErrors += 1;
        addAudit(records, "blob-read-error", {
          entryId: row.id,
          errorCode:
            error instanceof Error && "code" in error
              ? String(error.code)
              : "UNKNOWN",
          logicalPath: row.path,
          tier: row.tier,
        });
        continue;
      }
    }
    if (!stats) {
      missingBlobs += 1;
      addAudit(records, "missing-blob", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    }
    if (!stats.isFile()) {
      nonRegularBlobs += 1;
      addAudit(records, "non-regular-blob", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
        type: stats.isSymbolicLink() ? "symlink" : "special",
      });
      await handle?.close().catch(() => undefined);
      continue;
    }
    if (stats.size !== row.sizeBytes) {
      sizeMismatches += 1;
      addAudit(records, "size-mismatch", {
        actualBytes: stats.size,
        entryId: row.id,
        logicalPath: row.path,
        projectedBytes: row.sizeBytes,
        tier: row.tier,
      });
    }
    let actual: string;
    try {
      if (!handle) throw new Error("blob handle was not opened");
      actual = await checksumHandle(handle);
    } catch (error) {
      blobReadErrors += 1;
      addAudit(records, "blob-read-error", {
        entryId: row.id,
        errorCode:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "UNKNOWN",
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    } finally {
      await handle?.close().catch(() => undefined);
    }
    if (actual !== row.checksum.toLowerCase()) {
      checksumMismatches += 1;
      addAudit(records, "checksum-mismatch", {
        entryId: row.id,
        logicalPath: row.path,
        tier: row.tier,
      });
      continue;
    }
    if (stats.size !== row.sizeBytes) continue;
    verifiedBlobs += 1;
  }
  return {
    blobReadErrors,
    checksumMismatches,
    duplicateDiskPaths,
    malformedChecksums,
    missingBlobs,
    nonRegularBlobs,
    outOfRootDiskPaths,
    sizeMismatches,
    verifiedBlobs,
    wrongDiskPaths,
  };
}

async function scanBranch(
  tier: "hdd" | "ssd",
  root: string,
  excludedRoots: ReadonlySet<string>,
  referencedFiles: ReadonlySet<string>,
  records: AuditRecord[],
): Promise<BranchScan> {
  const counts: BranchScan = {
    directories: 0,
    excludedRoots: 0,
    hardLinks: 0,
    orphanFiles: 0,
    regularFiles: 0,
    scanErrors: 0,
    specialFiles: 0,
    symlinks: 0,
  };
  const resolvedRoot = resolve(root);
  try {
    const rootStats = await lstat(resolvedRoot);
    if (rootStats.isSymbolicLink()) {
      counts.symlinks += 1;
      addAudit(records, "symlink", { relativePath: ".", tier });
      return counts;
    }
    if (!rootStats.isDirectory()) {
      counts.specialFiles += 1;
      addAudit(records, "special-file", { relativePath: ".", tier });
      return counts;
    }
  } catch (error) {
    counts.scanErrors += 1;
    addAudit(records, "branch-scan-error", {
      errorCode:
        error instanceof Error && "code" in error
          ? String(error.code)
          : "UNKNOWN",
      relativePath: ".",
      tier,
    });
    return counts;
  }
  const pending: { absolute: string; relative: string }[] = [
    { absolute: resolvedRoot, relative: "." },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    let entries: Dirent[];
    try {
      entries = await readdir(current.absolute, { withFileTypes: true });
    } catch (error) {
      counts.scanErrors += 1;
      addAudit(records, "branch-scan-error", {
        errorCode:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "UNKNOWN",
        relativePath: current.relative,
        tier,
      });
      continue;
    }
    for (const entry of entries) {
      const absolute = join(current.absolute, entry.name);
      const relativePath =
        current.relative === "."
          ? entry.name
          : join(current.relative, entry.name);
      if ([...excludedRoots].some((path) => pathAtOrInside(path, absolute))) {
        counts.excludedRoots += 1;
        continue;
      }
      let stats: Stats;
      try {
        stats = await lstat(absolute);
      } catch (error) {
        counts.scanErrors += 1;
        addAudit(records, "branch-scan-error", {
          errorCode:
            error instanceof Error && "code" in error
              ? String(error.code)
              : "UNKNOWN",
          relativePath,
          tier,
        });
        continue;
      }
      if (stats.isSymbolicLink()) {
        counts.symlinks += 1;
        addAudit(records, "symlink", { relativePath, tier });
      } else if (stats.isDirectory()) {
        counts.directories += 1;
        pending.push({ absolute, relative: relativePath });
      } else if (stats.isFile()) {
        counts.regularFiles += 1;
        if (!referencedFiles.has(resolve(absolute))) {
          counts.orphanFiles += 1;
          addAudit(records, "orphan-blob", { relativePath, tier });
        }
        if (stats.nlink > 1) {
          counts.hardLinks += 1;
          addAudit(records, "hard-link", {
            linkCount: stats.nlink,
            relativePath,
            tier,
          });
        }
      } else {
        counts.specialFiles += 1;
        addAudit(records, "special-file", { relativePath, tier });
      }
    }
  }
  return counts;
}

interface MountEvidence {
  device: string;
  filesystem: string | null;
  mountPoint: boolean;
  readOnly: boolean | null;
  source: string | null;
}

function decodeMountField(value: string): string {
  return value.replace(/\\(040|011|012|134)/g, (match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

async function mountEvidence(
  roots: Record<"hdd" | "ssd", string>,
  requireMountPoints: boolean,
  records: AuditRecord[],
): Promise<{
  branches: Record<"hdd" | "ssd", MountEvidence>;
  distinctDevices: boolean;
  distinctRoots: boolean;
  healthy: boolean;
}> {
  const mountRows = new Map<
    string,
    { filesystem: string; options: string[]; source: string }
  >();
  if (process.platform === "linux") {
    const contents = await readFile("/proc/self/mountinfo", "utf8").catch(
      () => "",
    );
    for (const line of contents.split("\n")) {
      if (!line) continue;
      const fields = line.split(" ");
      const separator = fields.indexOf("-");
      const mountPoint = fields[4];
      const filesystem = fields[separator + 1];
      const source = fields[separator + 2];
      if (separator < 0 || !mountPoint || !filesystem || source === undefined) {
        continue;
      }
      mountRows.set(resolve(decodeMountField(mountPoint)), {
        filesystem,
        options: [fields[5] ?? "", fields[separator + 3] ?? ""]
          .flatMap((value) => value.split(","))
          .filter(Boolean),
        source: decodeMountField(source),
      });
    }
  }

  const branches = {} as Record<"hdd" | "ssd", MountEvidence>;
  const canonicalRoots = {} as Record<"hdd" | "ssd", string>;
  let healthy = true;
  for (const tier of ["ssd", "hdd"] as const) {
    try {
      const [metadata, canonical] = await Promise.all([
        lstat(roots[tier]),
        realpath(roots[tier]),
      ]);
      canonicalRoots[tier] = canonical;
      const mount = mountRows.get(resolve(roots[tier]));
      const isMountPoint = mount !== undefined;
      const readOnly = mount ? mount.options.includes("ro") : null;
      branches[tier] = {
        device: String(metadata.dev),
        filesystem: mount?.filesystem ?? null,
        mountPoint: isMountPoint,
        readOnly,
        source: mount?.source ?? null,
      };
      if (
        !metadata.isDirectory() ||
        (requireMountPoints && canonical !== resolve(roots[tier])) ||
        (requireMountPoints && (!isMountPoint || readOnly !== false))
      ) {
        healthy = false;
        addAudit(records, "branch-mount-invalid", {
          canonical,
          mountPoint: isMountPoint,
          readOnly,
          tier,
        });
      }
    } catch (error) {
      healthy = false;
      canonicalRoots[tier] = "";
      branches[tier] = {
        device: "unknown",
        filesystem: null,
        mountPoint: false,
        readOnly: null,
        source: null,
      };
      addAudit(records, "branch-mount-error", {
        errorCode:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "UNKNOWN",
        tier,
      });
    }
  }
  const distinctRoots =
    canonicalRoots.ssd !== "" && canonicalRoots.ssd !== canonicalRoots.hdd;
  const distinctDevices =
    branches.ssd.device !== "unknown" &&
    branches.ssd.device !== branches.hdd.device;
  if (!distinctRoots || (requireMountPoints && !distinctDevices)) {
    healthy = false;
    addAudit(records, "branch-distinctness-invalid", {
      distinctDevices,
      distinctRoots,
    });
  }
  return { branches, distinctDevices, distinctRoots, healthy };
}

async function archiveActivity(archivePath: string): Promise<{
  active: number | null;
  observable: boolean;
  reason: string | null;
  snapshotStatus: "current" | "invalid" | "missing" | "stale";
  stagedZipFiles: number | null;
}> {
  const [snapshot, staged] = await Promise.all([
    readArchiveJobSnapshot(archivePath),
    readdir(archivePath, { withFileTypes: true })
      .then(
        (entries) =>
          entries.filter(
            (entry) => entry.isFile() && entry.name.endsWith(".zip"),
          ).length,
      )
      .catch(() => null),
  ]);
  if (snapshot.status !== "current") {
    return {
      active: null,
      observable: false,
      reason:
        "reason" in snapshot
          ? snapshot.reason
          : "archive activity snapshot belongs to a stopped process",
      snapshotStatus: snapshot.status,
      stagedZipFiles: staged,
    };
  }
  return {
    active: snapshot.snapshot.activeJobs.length,
    observable: staged !== null,
    reason: staged === null ? "archive staging directory is unreadable" : null,
    snapshotStatus: "current",
    stagedZipFiles: staged,
  };
}

async function freeSpace(
  roots: Record<"hdd" | "ssd", string>,
  totals: Record<"hdd" | "ssd", TierTotals>,
  records: AuditRecord[],
): Promise<
  Record<
    "hdd" | "ssd",
    {
      availableBytes: number | null;
      canFitSecondCopy: boolean;
      deficitBytes: number;
      requiredBytes: number;
    }
  >
> {
  const result = {} as Record<
    "hdd" | "ssd",
    {
      availableBytes: number | null;
      canFitSecondCopy: boolean;
      deficitBytes: number;
      requiredBytes: number;
    }
  >;
  for (const tier of ["ssd", "hdd"] as const) {
    try {
      const stats = await statfs(roots[tier]);
      const availableBytes = stats.bavail * stats.bsize;
      const requiredBytes = totals[tier].bytes;
      result[tier] = {
        availableBytes,
        canFitSecondCopy: availableBytes >= requiredBytes,
        deficitBytes: Math.max(0, requiredBytes - availableBytes),
        requiredBytes,
      };
    } catch (error) {
      result[tier] = {
        availableBytes: null,
        canFitSecondCopy: false,
        deficitBytes: totals[tier].bytes,
        requiredBytes: totals[tier].bytes,
      };
      addAudit(records, "free-space-error", {
        errorCode:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "UNKNOWN",
        tier,
      });
    }
  }
  return result;
}

async function writeAudit(
  path: string,
  records: readonly AuditRecord[],
  forbiddenRoots: readonly string[],
): Promise<void> {
  const resolved = resolve(path);
  for (const root of forbiddenRoots) {
    if (pathAtOrInside(root, resolved)) {
      throw new ScriptError("Audit path must be outside every storage root");
    }
  }
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(dirname(resolved));
  const canonicalTarget = resolve(canonicalParent, posix.basename(resolved));
  for (const root of forbiddenRoots) {
    const canonicalRoot = await realpath(root).catch(() => resolve(root));
    if (pathAtOrInside(canonicalRoot, canonicalTarget)) {
      throw new ScriptError("Audit path resolves inside a storage root");
    }
  }
  const handle = await open(
    canonicalTarget,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  ).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new ScriptError("Audit path already exists; refusing to overwrite");
    }
    throw error;
  });
  try {
    await handle.chmod(0o600);
    for (const record of records) {
      await handle.writeFile(`${JSON.stringify(record)}\n`, {
        encoding: "utf8",
      });
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function collectPosixInventory(options: PosixInventoryOptions) {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const records: AuditRecord[] = [];
  const [fileRows, folderRows, tusRows] = await Promise.all([
    options.db
      .select({
        checksum: files.checksum,
        diskPath: files.diskPath,
        filename: files.filename,
        id: files.id,
        path: files.path,
        sizeBytes: files.sizeBytes,
        tier: files.tier,
      })
      .from(files),
    options.db
      .select({ id: folders.id, name: folders.name, path: folders.path })
      .from(folders),
    options.db
      .select({
        bytesReceived: tusUploads.bytesReceived,
        expiresAt: tusUploads.expiresAt,
        id: tusUploads.id,
        sizeBytes: tusUploads.sizeBytes,
      })
      .from(tusUploads)
      .where(eq(tusUploads.status, "in_progress")),
  ]);
  const roots = {
    hdd: resolve(options.hddStoragePath),
    ssd: resolve(options.ssdStoragePath),
  };
  const referencedFiles = new Set(
    fileRows.map((row) => expectedLegacyBlobPath(roots[row.tier], row)),
  );
  const excludedRoots = new Set<string>();
  let invalidExcludedPaths = 0;
  for (const configured of options.excludedPaths ?? [options.archivePath]) {
    const excluded = resolve(configured);
    if (
      !pathAtOrInside(roots.ssd, excluded) &&
      !pathAtOrInside(roots.hdd, excluded)
    ) {
      invalidExcludedPaths += 1;
      addAudit(records, "excluded-path-outside-branches", { path: excluded });
      continue;
    }
    excludedRoots.add(excluded);
  }
  const totals: Record<"hdd" | "ssd", TierTotals> = {
    hdd: { bytes: 0, files: 0 },
    ssd: { bytes: 0, files: 0 },
  };
  for (const row of fileRows) {
    totals[row.tier].files += 1;
    totals[row.tier].bytes += row.sizeBytes;
  }

  const logical = logicalEntryChecks(fileRows, folderRows, records);
  const blobs = await verifyBlobs(fileRows, roots, records);
  const [ssdScan, hddScan, archives, space, mounts] = await Promise.all([
    scanBranch("ssd", roots.ssd, excludedRoots, referencedFiles, records),
    scanBranch("hdd", roots.hdd, excludedRoots, referencedFiles, records),
    archiveActivity(options.archivePath),
    freeSpace(roots, totals, records),
    mountEvidence(roots, options.requireMountPoints ?? false, records),
  ]);
  const now = options.now?.getTime() ?? Date.now();
  const activeTus = {
    bytesReceived: tusRows.reduce((sum, row) => sum + row.bytesReceived, 0),
    count: tusRows.length,
    expiredCount: tusRows.filter((row) => row.expiresAt.getTime() <= now)
      .length,
    sizeBytes: tusRows.reduce((sum, row) => sum + row.sizeBytes, 0),
  };
  const issueCounts = {
    ...logical,
    ...blobs,
    hardLinks: ssdScan.hardLinks + hddScan.hardLinks,
    invalidExcludedPaths,
    orphanFiles: ssdScan.orphanFiles + hddScan.orphanFiles,
    scanErrors: ssdScan.scanErrors + hddScan.scanErrors,
    specialFiles: ssdScan.specialFiles + hddScan.specialFiles,
    symlinks: ssdScan.symlinks + hddScan.symlinks,
  };
  const blockingIssueCount =
    issueCounts.blobReadErrors +
    issueCounts.casefoldCollisions +
    issueCounts.checksumMismatches +
    issueCounts.duplicateIds +
    issueCounts.duplicateDiskPaths +
    issueCounts.duplicatePaths +
    issueCounts.hardLinks +
    issueCounts.invalidExcludedPaths +
    issueCounts.invalidNames +
    issueCounts.malformedChecksums +
    issueCounts.missingBlobs +
    issueCounts.nonRegularBlobs +
    issueCounts.outOfRootDiskPaths +
    issueCounts.orphanFiles +
    issueCounts.scanErrors +
    issueCounts.specialFiles +
    issueCounts.symlinks +
    issueCounts.sizeMismatches +
    issueCounts.wrongDiskPaths;
  const allGreen =
    blockingIssueCount === 0 &&
    mounts.healthy &&
    activeTus.count === 0 &&
    archives.observable &&
    archives.active === 0 &&
    space.ssd.canFitSecondCopy &&
    space.hdd.canFitSecondCopy;

  const summary = {
    activeJobs: { archives, tus: activeTus },
    allGreen,
    auditPath: resolve(options.auditPath),
    database: {
      files: {
        byTier: totals,
        bytes: totals.ssd.bytes + totals.hdd.bytes,
        count: fileRows.length,
      },
      folders: { count: folderRows.length },
    },
    filesystem: {
      branches: { hdd: hddScan, ssd: ssdScan },
      excludedRoots: [...excludedRoots].sort(),
      mounts,
    },
    freeSpaceForSecondCopy: space,
    generatedAt,
    issues: issueCounts,
    output: { auditTruncated: records.length >= MAX_AUDIT_RECORDS },
  };
  records.unshift({ at: generatedAt, event: "inventory-summary", ...summary });
  await writeAudit(options.auditPath, records, [
    roots.ssd,
    roots.hdd,
    ...excludedRoots,
  ]);
  return summary;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new ScriptError(`${flag} requires a value`);
  }
  return value;
}

function defaultAuditPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(tmpdir(), `deniz-cloud-posix-inventory-${timestamp}.jsonl`);
}

if (import.meta.main) {
  await runScript("posix-inventory", async (flags, log) => {
    if (!flags.dryRun) {
      throw new ScriptError(
        "posix-inventory is read-only; --execute is not supported",
      );
    }
    const ssdStoragePath = requiredEnv("SSD_STORAGE_PATH");
    const hddStoragePath = requiredEnv("HDD_STORAGE_PATH");
    const archivePath =
      process.env.STORAGE_ARCHIVE_PATH ?? join(ssdStoragePath, ".archives");
    const auditPath =
      flagValue(process.argv.slice(2), "--audit") ??
      process.env.POSIX_INVENTORY_AUDIT_PATH ??
      defaultAuditPath();
    const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
    try {
      const summary = await collectPosixInventory({
        archivePath,
        auditPath,
        db,
        excludedPaths: [
          archivePath,
          process.env.TEMP_UPLOAD_PATH ?? join(ssdStoragePath, ".tus-partial"),
          process.env.S3_ROOT_PATH ?? join(ssdStoragePath, ".s3-v2"),
          process.env.S3_TEMP_PATH ?? join(ssdStoragePath, ".s3-v2-temp"),
        ],
        hddStoragePath,
        requireMountPoints: true,
        ssdStoragePath,
      });
      await log.event("inventory-collected", {
        allGreen: summary.allGreen,
        auditPath: summary.auditPath,
        files: summary.database.files.count,
        folders: summary.database.folders.count,
      });
      if (!summary.allGreen) {
        await log.event("gate-blocked", {
          blockingIssues: Object.entries(summary.issues)
            .filter(([, count]) => count > 0)
            .map(([name, count]) => ({ count, name })),
        });
        process.exitCode = 1;
      }
      return summary;
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  });
}
