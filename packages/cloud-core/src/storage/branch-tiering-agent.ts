import {
  chmod,
  chown,
  lstat,
  open,
  rename,
  unlink,
  utimes,
} from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

import type { StorageTier } from "../db/schema";
import {
  computeChecksum,
  copyAndVerify,
  deletePath,
  directoryHasEntries,
  ensureDir,
  fsyncFile,
  getDiskStats,
  pathExists,
} from "./fs";
import { PROTECTED_XATTR_KEYS } from "./metadata";
import type {
  BranchUsagePayload,
  TierMovePayload,
  TierPlacementPayload,
} from "./metadata-protocol";
import { NamespaceResolveError, namespaceSegments } from "./metadata-resolve";
import type { XattrBackend } from "./xattr";

export interface BranchRoots {
  ssd: string;
  hdd: string;
}

/**
 * Every protected attribute a publish has to carry across.
 *
 * Identity is the one that matters: an entry that lands on the other branch
 * without its `id` is a new file to the projector, and the old row becomes a
 * reap candidate for bytes that are still there.
 */
const CARRIED_XATTRS = Object.values(PROTECTED_XATTR_KEYS);

/** Vetoed at every protocol boundary, so a client can never address one. */
function hiddenTempName(name: string): string {
  return `.${name}.tiering.${process.pid}.${Date.now()}.partial`;
}

function otherTier(tier: StorageTier): StorageTier {
  return tier === "ssd" ? "hdd" : "ssd";
}

/**
 * Moves bytes between physical branches on behalf of the unprivileged API.
 *
 * Only this side of the socket knows where the branches are, and only it can
 * read or write `security.denizcloud.*`. The API sends a namespace-relative
 * path and the identity it planned against; everything about placement is
 * decided here against what the disks actually hold.
 */
export class BranchTieringAgent {
  constructor(
    private readonly roots: BranchRoots,
    private readonly xattr: XattrBackend,
  ) {}

  private branchPath(tier: StorageTier, relativePath: string): string {
    const root = this.roots[tier];
    const segments = namespaceSegments(relativePath);
    if (segments.length === 0) {
      throw new NamespaceResolveError("Path names the root", "INVALID_PATH");
    }
    const resolved = join(root, ...segments);
    if (!resolved.startsWith(`${root}${sep}`)) {
      throw new NamespaceResolveError(
        `Path escapes the branch root: ${relativePath}`,
        "ESCAPE",
      );
    }
    return resolved;
  }

  /**
   * Refuses to answer from a branch that is not mounted.
   *
   * An unmounted branch is an empty directory, and reporting "every path lives
   * on the other tier" from one would make the pass migrate the entire
   * namespace onto a single disk.
   */
  private async branchesMounted(): Promise<boolean> {
    return (
      (await directoryHasEntries(this.roots.ssd)) &&
      (await directoryHasEntries(this.roots.hdd))
    );
  }

  async usage(): Promise<BranchUsagePayload[]> {
    if (!(await this.branchesMounted())) {
      throw new Error("A physical branch is not mounted");
    }
    const tiers: StorageTier[] = ["ssd", "hdd"];
    return Promise.all(
      tiers.map(async (tier) => {
        const stats = await getDiskStats(this.roots[tier]);
        return {
          freeBytes: stats.availableBytes,
          tier,
          totalBytes: stats.totalBytes,
          usagePercent: stats.usagePercent,
          usedBytes: stats.usedBytes,
        };
      }),
    );
  }

  async locate(
    relativePaths: readonly string[],
  ): Promise<TierPlacementPayload[]> {
    if (!(await this.branchesMounted())) {
      throw new Error("A physical branch is not mounted");
    }
    const placements: TierPlacementPayload[] = [];
    for (const relativePath of relativePaths) {
      let onSsd = false;
      let onHdd = false;
      try {
        onSsd = await pathExists(this.branchPath("ssd", relativePath));
        onHdd = await pathExists(this.branchPath("hdd", relativePath));
      } catch {
        // An unresolvable path is not on either branch as far as tiering is
        // concerned; the projector reports it separately as a problem.
        placements.push({ duplicate: false, relativePath, tier: null });
        continue;
      }
      placements.push({
        duplicate: onSsd && onHdd,
        relativePath,
        tier: onSsd ? "ssd" : onHdd ? "hdd" : null,
      });
    }
    return placements;
  }

  private async carryMetadata(
    source: string,
    destination: string,
  ): Promise<void> {
    const stats = await lstat(source);
    await chown(destination, stats.uid, stats.gid);
    await chmod(destination, stats.mode & 0o7777);
    for (const key of CARRIED_XATTRS) {
      const value = await this.xattr.get(source, key);
      if (value !== null) await this.xattr.set(destination, key, value);
    }
    // Last, because writing xattrs updates ctime and can update mtime on some
    // filesystems. Clients read mtime, so it has to be the source's.
    await utimes(destination, stats.atime, stats.mtime);
  }

  private async fsyncDirectory(path: string): Promise<void> {
    // A rename is only durable once its parent directory entry is. Publishing
    // without this survives a clean stop and loses the file on a power cut.
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Copy → verify → publish → unlink, in that order and no other.
   *
   * Each crash point leaves the merged view serving verified bytes: before the
   * publish the source is still the only visible copy, after it both copies are
   * identical and the duplicate reconciles on the projected tier hint. The one
   * thing that must never happen is unlinking the source before the
   * destination is durable, which is why the fsyncs are not optional.
   */
  async move(input: {
    relativePath: string;
    toTier: StorageTier;
    expectedId: string;
    expectedChecksum: string;
  }): Promise<TierMovePayload> {
    const { expectedChecksum, expectedId, relativePath, toTier } = input;
    const fromTier = otherTier(toTier);
    const refuse = (
      outcome: TierMovePayload["outcome"],
      reason: string | null,
      from: StorageTier | null = fromTier,
    ): TierMovePayload => ({ from, outcome, reason, relativePath, to: toTier });

    if (!(await this.branchesMounted())) {
      return refuse("deferred", "branch-not-mounted", null);
    }

    const source = this.branchPath(fromTier, relativePath);
    const destination = this.branchPath(toTier, relativePath);

    if (!(await pathExists(source))) {
      // Already where it was headed, so the projection was merely stale. Not a
      // failure and not something to redo.
      return (await pathExists(destination))
        ? refuse("already-placed", null, toTier)
        : refuse("vanished", null, null);
    }
    if (await pathExists(destination)) {
      return refuse("quarantined", "duplicate-across-branches");
    }

    const sourceStats = await lstat(source);
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
      return refuse("deferred", "not-a-regular-file");
    }
    const actualId = await this.xattr.get(source, PROTECTED_XATTR_KEYS.id);
    if (actualId !== expectedId) {
      // A different entry now occupies the path. Moving it would relocate a
      // file nobody planned against and detach the planned row from its bytes.
      return refuse("vanished", "identity-changed", null);
    }

    const temp = join(
      dirname(destination),
      hiddenTempName(basename(relativePath)),
    );
    await ensureDir(dirname(destination));
    try {
      await copyAndVerify(source, temp, expectedChecksum);
      await this.carryMetadata(source, temp);
      await fsyncFile(temp);
      // Re-check identity on the source immediately before publishing: a write
      // that landed during the copy would make the verified bytes stale.
      const stillSame = await this.xattr.get(source, PROTECTED_XATTR_KEYS.id);
      const sourceChecksum = await computeChecksum(source);
      if (stillSame !== expectedId || sourceChecksum !== expectedChecksum) {
        await deletePath(temp);
        return refuse("deferred", "source-changed-during-copy");
      }
      await rename(temp, destination);
      await this.fsyncDirectory(dirname(destination));
    } catch (error) {
      await deletePath(temp).catch(() => {});
      throw error;
    }

    await unlink(source).catch(() => {
      // The destination is durable and published; a source that refuses to go
      // is a duplicate to reconcile, not a lost move.
    });
    await this.fsyncDirectory(dirname(source)).catch(() => {});
    return {
      from: fromTier,
      outcome: "moved",
      reason: null,
      relativePath,
      to: toTier,
    };
  }
}
