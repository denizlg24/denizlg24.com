import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BRANCH_MARKER_FILENAME = ".denizcloud-branch.json";

/**
 * Proof that every physical branch was mounted for the whole of a scan.
 *
 * `scanMayCount` compares the map returned at the start of a walk with the one
 * returned at the end, and only a scan whose maps match may reap rows. That
 * comparison is what stands between a branch dropping out mid-scan and the
 * projector concluding that half the namespace was deleted.
 *
 * The comparison alone is not enough, which is why this returns all-or-nothing.
 * A branch that is already unmounted when the scan starts is still unmounted
 * when it ends, so a per-branch map would match itself, look complete, and
 * license reaping every row that lived on the missing disk. This is the same
 * hazard the tiering pass guards against by refusing to reap from an empty tier
 * root. An empty map is read by `scanMayCount` as `no-branch-markers` and
 * withholds every deletion, so failing to read one marker withholds them all.
 */
export async function readBranchMarkers(
  branchPaths: readonly string[],
): Promise<Record<string, string>> {
  if (branchPaths.length === 0) return {};

  const markers: Record<string, string> = {};
  for (const branchPath of branchPaths) {
    let raw: string;
    try {
      raw = await readFile(join(branchPath, BRANCH_MARKER_FILENAME), "utf8");
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (typeof parsed !== "object" || parsed === null) return {};
    const { branchId, filesystemUuid } = parsed as {
      branchId?: unknown;
      filesystemUuid?: unknown;
    };
    if (typeof branchId !== "string" || branchId.length === 0) return {};
    if (typeof filesystemUuid !== "string" || filesystemUuid.length === 0) {
      return {};
    }
    // The filesystem UUID is part of the value, not just the branch id, so a
    // different disk carrying a copied marker reads as a different branch.
    markers[branchPath] = `${branchId}:${filesystemUuid}`;
  }
  return markers;
}
