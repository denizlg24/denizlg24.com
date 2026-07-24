import { join } from "node:path/posix";

const INVALID_SEGMENTS = new Set([".", ".."]);
const MAX_SEGMENT_LENGTH = 255;

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
}

export function toSnakeCase(input: string): string {
  return input
    .replace(/[\s-]+/g, "_")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function validatePathSegment(segment: string): void {
  if (!segment) {
    throw new PathValidationError("Path segment cannot be empty");
  }
  if (INVALID_SEGMENTS.has(segment)) {
    throw new PathValidationError(`Invalid path segment: "${segment}"`);
  }
  if (segment.includes("\0")) {
    throw new PathValidationError("Path segment contains null byte");
  }
  if (segment.length > MAX_SEGMENT_LENGTH) {
    throw new PathValidationError(
      `Path segment exceeds ${MAX_SEGMENT_LENGTH} characters`,
    );
  }
  if (/[<>:"|?*\\/]/.test(segment)) {
    throw new PathValidationError(
      `Path segment contains invalid characters: "${segment}"`,
    );
  }
}

export function validatePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new PathValidationError("Path must start with /");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new PathValidationError("Path must not end with /");
  }
  if (path.includes("//")) {
    throw new PathValidationError("Path must not contain double slashes");
  }
  for (const segment of path.split("/").filter(Boolean)) {
    validatePathSegment(segment);
  }
}

export function normalizeName(name: string): string {
  const normalized = toSnakeCase(name);
  if (!normalized) {
    throw new PathValidationError("Name is empty after normalization");
  }
  validatePathSegment(normalized);
  return normalized;
}

export function normalizeFileName(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return normalizeName(name);
  }
  const result = `${normalizeName(name.slice(0, dotIndex))}.${name
    .slice(dotIndex + 1)
    .toLowerCase()}`;
  validatePathSegment(result);
  return result;
}

export function joinPath(...segments: string[]): string {
  return `/${segments
    .map((segment) => segment.replace(/^\/|\/$/g, ""))
    .filter(Boolean)
    .join("/")}`;
}

export function parentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : path.slice(0, lastSlash);
}

export function resolveSsdDiskPath(
  basePath: string,
  virtualPath: string,
): string {
  const resolved = join(basePath, virtualPath);
  return resolved.length > 1 ? resolved.replace(/\/$/, "") : resolved;
}

export function resolveHddDiskPath(basePath: string, fileId: string): string {
  return join(basePath, fileId);
}

export function buildUserRootPath(userId: string): string {
  return `/${userId}`;
}

export const SHARED_ROOT_PATH = "/shared";

export function isSharedPath(path: string): boolean {
  return path === SHARED_ROOT_PATH || path.startsWith(`${SHARED_ROOT_PATH}/`);
}

export function buildProjectRootPath(slug: string): string {
  return `/${slug}`;
}

export function isProjectPath(path: string, projectSlug: string): boolean {
  const root = buildProjectRootPath(projectSlug);
  return path === root || path.startsWith(`${root}/`);
}
