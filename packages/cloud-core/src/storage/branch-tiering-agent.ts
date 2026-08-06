import {
  chmod,
  chown,
  link,
  lstat,
  open,
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
  /**
   * Paths with a move in progress.
   *
   * The publish is already safe against a concurrent mover — `link` fails with
   * EEXIST rather than replacing — but letting two requests copy the same
   * multi-gigabyte file only for one to be quarantined turns a scheduling
   * overlap into a false duplicate alert. One socket serves every caller, so
   * the second request is refused here instead.
   */
  readonly #inFlight = new Set<string>();

  constructor(
    private readonly roots: BranchRoots,
    private readonly xattr: XattrBackend,
  ) {}

  /**
   * Builds a branch path, refusing to traverse a symlink at any depth.
   *
   * `namespaceSegments` rejects `..`, which is not the same guarantee: a
   * symlinked directory component resolves outside the branch without any
   * `..` appearing in the path. Every existing component is `lstat`ed as it is
   * appended, exactly as `resolveNamespacePath` does for the merged namespace.
   * That function cannot be reused here because a destination path legitimately
   * does not exist yet — a missing component ends the walk rather than failing
   * it, and `ensureDir` creates the rest beneath a prefix already proven clean.
   */
  private async branchPath(
    tier: StorageTier,
    relativePath: string,
  ): Promise<string> {
    const root = this.roots[tier];
    const segments = namespaceSegments(relativePath);
    if (segments.length === 0) {
      throw new NamespaceResolveError("Path names the root", "INVALID_PATH");
    }
    let current = root;
    for (const segment of segments) {
      current = join(current, segment);
      if (!current.startsWith(`${root}${sep}`)) {
        throw new NamespaceResolveError(
          `Path escapes the branch root: ${relativePath}`,
          "ESCAPE",
        );
      }
      let stats: Awaited<ReturnType<typeof lstat>>;
      try {
        stats = await lstat(current);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "ENOENT" || error.code === "ENOTDIR")
        ) {
          // Nothing further can be a symlink if this component is absent.
          break;
        }
        throw error;
      }
      if (stats.isSymbolicLink()) {
        throw new NamespaceResolveError(
          `Symlink in path: ${relativePath}`,
          "SYMLINK",
        );
      }
    }
    return join(root, ...segments);
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
        onSsd = await pathExists(await this.branchPath("ssd", relativePath));
        onHdd = await pathExists(await this.branchPath("hdd", relativePath));
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

  /**
   * A publish is only durable once its parent directory entry is; without this
   * a move survives a clean stop and loses the file on a power cut.
   *
   * Never fatal. Opening a directory and syncing it is not uniformly supported
   * across runtimes, and by the time this is called the destination is already
   * linked and its bytes are already fsynced. Turning "the durability hint was
   * refused" into a failed move would re-copy a file that is correctly in
   * place.
   */
  private async fsyncDirectory(path: string): Promise<void> {
    try {
      const handle = await open(path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.warn("Directory fsync unavailable", { error, path });
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
    const { relativePath } = input;
    if (this.#inFlight.has(relativePath)) {
      return {
        from: null,
        outcome: "deferred",
        reason: "move-already-in-progress",
        relativePath,
        to: input.toTier,
      };
    }
    this.#inFlight.add(relativePath);
    try {
      return await this.#move(input);
    } finally {
      this.#inFlight.delete(relativePath);
    }
  }

  async #move(input: {
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

    const source = await this.branchPath(fromTier, relativePath);
    const destination = await this.branchPath(toTier, relativePath);

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
      // `link`, not `rename`. The destination-absent check above happened
      // before the copy, and for a large file that gap is minutes; `rename(2)`
      // replaces an existing destination atomically and silently, so anything
      // that created this path meanwhile would be published over and lost.
      // `link(2)` fails with EEXIST instead, which is the atomic version of
      // the check and routes into the same quarantine.
      try {
        await link(temp, destination);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          await deletePath(temp);
          return refuse("quarantined", "duplicate-across-branches");
        }
        throw error;
      }
      await unlink(temp).catch(() => {});
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
