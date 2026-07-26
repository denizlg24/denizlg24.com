import { buildUserRootPath, joinPath, SHARED_ROOT_PATH } from "../storage/path";

/**
 * The two collections a mounted drive shows at its top level. A user's storage
 * root is `/<uuid>`, which is unusable as the name of a network drive's folder,
 * so the mount presents these stable aliases instead.
 */
export const DAV_HOME = "home";
export const DAV_SHARED = "shared";

export type DavTarget = { kind: "root" } | { kind: "storage"; path: string };

/**
 * Splits and percent-decodes a URL path. A segment that decodes to something
 * containing a slash or a null byte is rejected rather than decoded: `%2F` is
 * the standard way to try to escape the mount root.
 */
function decodeSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (!raw) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (
      decoded.includes("/") ||
      decoded.includes("\0") ||
      decoded === "." ||
      decoded === ".."
    ) {
      return null;
    }
    segments.push(decoded);
  }
  return segments;
}

export function davPathToStorage(
  pathname: string,
  userId: string,
): DavTarget | null {
  const segments = decodeSegments(pathname);
  if (!segments) return null;
  if (segments.length === 0) return { kind: "root" };
  const [head, ...rest] = segments;
  if (head === DAV_HOME) {
    return {
      kind: "storage",
      path: joinPath(buildUserRootPath(userId), ...rest),
    };
  }
  if (head === DAV_SHARED) {
    return { kind: "storage", path: joinPath(SHARED_ROOT_PATH, ...rest) };
  }
  return null;
}

export function storagePathToDav(
  storagePath: string,
  userId: string,
): string | null {
  const userRoot = buildUserRootPath(userId);
  if (storagePath === userRoot) return `/${DAV_HOME}`;
  if (storagePath.startsWith(`${userRoot}/`)) {
    return `/${DAV_HOME}${storagePath.slice(userRoot.length)}`;
  }
  if (storagePath === SHARED_ROOT_PATH) return `/${DAV_SHARED}`;
  if (storagePath.startsWith(`${SHARED_ROOT_PATH}/`)) {
    return `/${DAV_SHARED}${storagePath.slice(SHARED_ROOT_PATH.length)}`;
  }
  return null;
}

export function davHref(
  mountPath: string,
  davPath: string,
  isCollection: boolean,
): string {
  const encoded = davPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const base = encoded ? `${mountPath}/${encoded}` : mountPath;
  return isCollection ? `${base}/` : base;
}

/**
 * Resolves a Destination header against the mount. MOVE and COPY send an
 * absolute URL, and Windows sends one built from the Host it was given, so the
 * origin is discarded and only the path is honoured.
 */
export function destinationPath(
  destination: string,
  mountPath: string,
): string | null {
  let pathname: string;
  try {
    pathname = new URL(destination, "http://placeholder.invalid").pathname;
  } catch {
    return null;
  }
  if (pathname === mountPath) return "/";
  if (!pathname.startsWith(`${mountPath}/`)) return null;
  const remainder = pathname.slice(mountPath.length);
  return remainder.length > 1 ? remainder.replace(/\/$/, "") : "/";
}
