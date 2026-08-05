import { lstat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export class NamespaceResolveError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PATH"
      | "SYMLINK"
      | "ESCAPE"
      | "NOT_FOUND"
      | "UNSUPPORTED_TYPE",
  ) {
    super(message);
    this.name = "NamespaceResolveError";
  }
}

/** Names the namespace owns; a client may never address one. */
const RESERVED_NAMES = new Set([
  ".denizcloud-branch.json",
  ".denizcloud-mount-witness",
]);

const RESERVED_PATTERNS = [
  /^\._/, // AppleDouble sidecars are protocol metadata, never entries
  /\.migration\.partial$/,
  /\.reverse\.partial$/,
  /^\.witness\.partial\./,
];

export function isReservedSegment(segment: string): boolean {
  return (
    RESERVED_NAMES.has(segment) ||
    RESERVED_PATTERNS.some((pattern) => pattern.test(segment))
  );
}

/**
 * Splits a namespace-relative path into validated segments.
 *
 * Rejects rather than normalises: `a/../b` is not rewritten to `b`, because a
 * caller that produced `..` is not describing the entry it thinks it is, and
 * silently repointing it is how traversal bugs become data loss.
 */
export function namespaceSegments(relativePath: string): string[] {
  if (relativePath.includes("\0")) {
    throw new NamespaceResolveError("Path contains NUL", "INVALID_PATH");
  }
  const trimmed = relativePath.replace(/^\/+/, "");
  if (trimmed.length === 0) return [];
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new NamespaceResolveError(
        `Empty segment in ${relativePath}`,
        "INVALID_PATH",
      );
    }
    if (segment === "." || segment === "..") {
      throw new NamespaceResolveError(
        `Relative segment in ${relativePath}`,
        "INVALID_PATH",
      );
    }
    if (segment.includes(sep) || segment.includes("\\")) {
      throw new NamespaceResolveError(
        `Separator inside segment of ${relativePath}`,
        "INVALID_PATH",
      );
    }
    if (isReservedSegment(segment)) {
      throw new NamespaceResolveError(
        `Reserved name in ${relativePath}`,
        "INVALID_PATH",
      );
    }
  }
  return segments;
}

export interface ResolvedEntry {
  absolutePath: string;
  kind: "file" | "folder";
  sizeBytes: number;
  modifiedAt: Date;
}

/**
 * Resolves a namespace-relative path beneath `root`, refusing to traverse a
 * symlink at any depth.
 *
 * Each component is `lstat`ed as it is appended, so a symlink placed midway
 * through the path is rejected before the next component is even built. A
 * single `realpath` at the end would be a TOCTOU race: it answers where the
 * path pointed at the moment it was called, not where the subsequent open
 * goes. This still races in principle — the guarantee is that a link cannot be
 * *followed*, not that the tree is frozen — which is why the caller re-verifies
 * identity on the opened entry rather than trusting the path.
 */
export async function resolveNamespacePath(
  root: string,
  relativePath: string,
): Promise<ResolvedEntry> {
  const absoluteRoot = resolve(root);
  const segments = namespaceSegments(relativePath);
  let current = absoluteRoot;

  for (const segment of segments) {
    current = join(current, segment);
    if (
      current !== absoluteRoot &&
      !current.startsWith(`${absoluteRoot}${sep}`)
    ) {
      throw new NamespaceResolveError(
        `Path escapes the namespace root: ${relativePath}`,
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
        throw new NamespaceResolveError(
          `No such entry: ${relativePath}`,
          "NOT_FOUND",
        );
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new NamespaceResolveError(
        `Symlink in path: ${relativePath}`,
        "SYMLINK",
      );
    }
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new NamespaceResolveError(
        `Unsupported object in path: ${relativePath}`,
        "UNSUPPORTED_TYPE",
      );
    }
  }

  const finalStats = await lstat(current);
  return {
    absolutePath: current,
    kind: finalStats.isDirectory() ? "folder" : "file",
    modifiedAt: finalStats.mtime,
    sizeBytes: finalStats.isDirectory() ? 0 : finalStats.size,
  };
}
