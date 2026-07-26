import { Hono } from "hono";

import type { Folder, StorageFile } from "../db/schema";
import type { SafeUserRecord } from "../services/types";
import type { StoragePrincipal } from "../storage/access";
import {
  buildUserRootPath,
  parentPath,
  SHARED_ROOT_PATH,
} from "../storage/path";
import {
  type NamingPolicy,
  type StorageEntry,
  StorageServiceError,
} from "../storage/service";
import {
  DavLockStore,
  isLockRefresh,
  parseIfHeader,
  parseLockOwner,
  parseLockTokenHeader,
  parseTimeoutHeader,
  renderActiveLock,
} from "./locks";
import {
  DAV_HOME,
  DAV_SHARED,
  davHref,
  davPathToStorage,
  destinationPath,
  storagePathToDav,
} from "./mapping";
import {
  buildPropstats,
  type DavResource,
  type PropertyContext,
} from "./properties";
import {
  buildMultistatus,
  type DavResponseEntry,
  escapeXml,
  parsePropfind,
  STATUS_FORBIDDEN,
  STATUS_OK,
} from "./xml";

export const DAV_METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "PROPFIND",
  "PROPPATCH",
  "MKCOL",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
] as const;

const ROOT_DISPLAY_NAME = "Deniz Cloud";
const ROOT_CREATED_AT = new Date(0);

/** Live DAV properties no client is allowed to write. */
const PROTECTED_PROPS = new Set([
  "resourcetype",
  "getcontentlength",
  "getetag",
  "creationdate",
  "lockdiscovery",
  "supportedlock",
]);

export interface DavVariables {
  user: SafeUserRecord;
}

/**
 * The slice of StorageService this router uses. `StorageService` satisfies it
 * structurally; naming it separately keeps the verb handlers testable without
 * a database, Meilisearch and a disk behind them.
 */
export interface DavStorage {
  roots(principal: StoragePrincipal): Promise<unknown>;
  resolvePath(
    principal: StoragePrincipal,
    path: string,
  ): Promise<StorageEntry | null>;
  listChildren(
    principal: StoragePrincipal,
    folder: Folder,
  ): Promise<{ folders: Folder[]; files: StorageFile[] }>;
  download(
    principal: StoragePrincipal,
    id: string,
    request: Request,
  ): Promise<Response>;
  putFile(
    principal: StoragePrincipal,
    parent: Folder,
    filename: string,
    request: Request,
    naming?: NamingPolicy,
  ): Promise<{ file: StorageFile; created: boolean }>;
  copyFile(
    principal: StoragePrincipal,
    file: StorageFile,
    parent: Folder,
    filename: string,
    naming?: NamingPolicy,
  ): Promise<{ file: StorageFile; created: boolean }>;
  createFolder(
    principal: StoragePrincipal,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<Folder>;
  updateFile(
    principal: StoragePrincipal,
    id: string,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<unknown>;
  updateFolder(
    principal: StoragePrincipal,
    id: string,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<unknown>;
  deleteFile(principal: StoragePrincipal, id: string): Promise<void>;
  deleteFolder(
    principal: StoragePrincipal,
    id: string,
    recursive?: boolean,
  ): Promise<{ deletedFolders: number; deletedFiles: number }>;
}

/**
 * Ceilings for a single recursive COPY. Generous enough that no ordinary
 * folder drag hits them, low enough that one request cannot walk an entire
 * home directory onto the same disk.
 */
const DEFAULT_COPY_MAX_ENTRIES = 10_000;
const DEFAULT_COPY_MAX_BYTES = 50 * 1024 * 1024 * 1024;

class CopyTooLargeError extends Error {
  constructor() {
    super("Copy exceeds the maximum size for a single request");
    this.name = "CopyTooLargeError";
  }
}

export interface DavRoutesOptions {
  service: DavStorage;
  mountPath: string;
  locks?: DavLockStore;
  copyMaxEntries?: number;
  copyMaxBytes?: number;
  quota?: (userId: string) => Promise<{
    usedBytes: number;
    availableBytes: number;
  } | null>;
}

/**
 * Files the operating system writes to a network volume for its own
 * bookkeeping, which no user ever asked to store.
 *
 * Finder writes `.DS_Store` into every directory it displays and an AppleDouble
 * `._name` beside every file it copies — WebDAV carries no extended attributes,
 * so it falls back to sidecar files whether or not there is anything to put in
 * them. Left alone these outnumber the real files, land in the search index,
 * and follow the data into every archive and COPY.
 *
 * They are answered as though they were written, then dropped. Refusing them
 * outright surfaces in Finder as a failed copy of the file the sidecar belongs
 * to, which is worse than losing metadata nothing here reads. The tradeoff is
 * that a genuine resource fork does not survive a round trip through the mount.
 */
// Lowercase, and compared lowercased. Both operating systems treat these names
// case-insensitively and spell them inconsistently — Explorer asks for
// `Desktop.ini` and writes `desktop.ini` — while the filesystem underneath is
// case-sensitive, so matching exactly would store one spelling and drop the
// other.
const OS_METADATA_NAMES = new Set([
  ".ds_store",
  ".localized",
  ".apdisk",
  "desktop.ini",
  "thumbs.db",
  ".spotlight-v100",
  ".temporaryitems",
  ".trashes",
  ".fseventsd",
  ".documentrevisions-v100",
]);
const OS_METADATA_PREFIXES = ["._"];

function isOsMetadataPath(storagePath: string): boolean {
  const name = storagePath
    .slice(storagePath.lastIndexOf("/") + 1)
    .toLowerCase();
  return (
    OS_METADATA_NAMES.has(name) ||
    OS_METADATA_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function davErrorResponse(error: unknown): Response {
  if (error instanceof StorageServiceError) {
    return new Response(null, { status: error.status });
  }
  if (error instanceof CopyTooLargeError) {
    return new Response(null, { status: 507 });
  }
  console.error("WebDAV request failed", error);
  return new Response(null, { status: 500 });
}

export function davRoutes(options: DavRoutesOptions) {
  const { service, mountPath } = options;
  const locks = options.locks ?? new DavLockStore();
  const copyMaxEntries = options.copyMaxEntries ?? DEFAULT_COPY_MAX_ENTRIES;
  const copyMaxBytes = options.copyMaxBytes ?? DEFAULT_COPY_MAX_BYTES;
  const app = new Hono<{ Variables: DavVariables }>();

  const principalFor = (user: SafeUserRecord): StoragePrincipal => ({ user });

  const davPathOf = (url: string): string => {
    const { pathname } = new URL(url);
    const remainder = pathname.slice(mountPath.length);
    if (!remainder || remainder === "/") return "/";
    return remainder.replace(/\/$/, "");
  };

  const folderResource = (folder: Folder, davPath: string): DavResource => ({
    href: davHref(mountPath, davPath, true),
    storagePath: folder.path,
    isCollection: true,
    displayName: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    sizeBytes: null,
    mimeType: null,
    etag: null,
  });

  const fileResource = (file: StorageFile, davPath: string): DavResource => ({
    href: davHref(mountPath, davPath, false),
    storagePath: file.path,
    isCollection: false,
    displayName: file.filename,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
    etag: file.checksum,
  });

  const rootResource = (): DavResource => ({
    href: davHref(mountPath, "/", true),
    storagePath: null,
    isCollection: true,
    displayName: ROOT_DISPLAY_NAME,
    createdAt: ROOT_CREATED_AT,
    updatedAt: new Date(),
    sizeBytes: null,
    mimeType: null,
    etag: null,
  });

  const propertyContext = async (
    principal: StoragePrincipal,
  ): Promise<PropertyContext> => {
    const quota = await options.quota?.(principal.user.id).catch(() => null);
    return {
      locks,
      quotaUsedBytes: quota?.usedBytes ?? null,
      quotaAvailableBytes: quota?.availableBytes ?? null,
    };
  };

  /**
   * The two aliases the mount root exposes. `roots()` is called for its side
   * effect as much as its result: it creates the user's storage root and the
   * shared root on first touch, so a freshly provisioned account can be mounted
   * before it has ever been opened in the web client.
   */
  const rootChildren = async (
    principal: StoragePrincipal,
  ): Promise<Array<{ folder: Folder; davPath: string }>> => {
    await service.roots(principal);
    const [home, shared] = await Promise.all([
      service.resolvePath(principal, buildUserRootPath(principal.user.id)),
      service.resolvePath(principal, SHARED_ROOT_PATH),
    ]);
    const children: Array<{ folder: Folder; davPath: string }> = [];
    if (home?.kind === "folder") {
      children.push({ folder: home.folder, davPath: `/${DAV_HOME}` });
    }
    if (shared?.kind === "folder") {
      children.push({ folder: shared.folder, davPath: `/${DAV_SHARED}` });
    }
    return children;
  };

  const lockedResponse = (
    path: string,
    ifHeader: string | null | undefined,
  ) => {
    const blocking = locks.blocking(path, parseIfHeader(ifHeader));
    return blocking ? new Response(null, { status: 423 }) : null;
  };

  /** For operations that destroy members, not just the named resource. */
  const subtreeLockedResponse = (
    path: string,
    ifHeader: string | null | undefined,
  ) => {
    const blocking = locks.blockingWithin(path, parseIfHeader(ifHeader));
    return blocking ? new Response(null, { status: 423 }) : null;
  };

  app.on("OPTIONS", ["/", "/*"], (context) => {
    context.header("DAV", "1, 2");
    context.header("MS-Author-Via", "DAV");
    context.header("Allow", DAV_METHODS.join(", "));
    context.header("Accept-Ranges", "bytes");
    context.header("Content-Length", "0");
    return context.body(null, 200);
  });

  app.on("PROPFIND", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target) return context.body(null, 404);

    const depthHeader = context.req.header("Depth") ?? "1";
    if (depthHeader === "infinity") {
      return new Response(
        '<?xml version="1.0" encoding="utf-8"?>' +
          '<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>',
        { status: 403, headers: { "Content-Type": "application/xml" } },
      );
    }
    const depth = depthHeader === "0" ? 0 : 1;

    try {
      const request = parsePropfind(await context.req.text());
      const propContext = await propertyContext(principal);
      const entries: DavResponseEntry[] = [];

      if (target.kind === "root") {
        entries.push({
          href: rootResource().href,
          propstats: buildPropstats(rootResource(), request, propContext),
        });
        if (depth === 1) {
          for (const child of await rootChildren(principal)) {
            const resource = folderResource(child.folder, child.davPath);
            entries.push({
              href: resource.href,
              propstats: buildPropstats(resource, request, propContext),
            });
          }
        }
        return multistatus(entries);
      }

      const entry = await service.resolvePath(principal, target.path);
      if (!entry) return context.body(null, 404);

      if (entry.kind === "file") {
        const resource = fileResource(entry.file, davPath);
        return multistatus([
          {
            href: resource.href,
            propstats: buildPropstats(resource, request, propContext),
          },
        ]);
      }

      const resource = folderResource(entry.folder, davPath);
      entries.push({
        href: resource.href,
        propstats: buildPropstats(resource, request, propContext),
      });
      if (depth === 1) {
        const children = await service.listChildren(principal, entry.folder);
        for (const child of children.folders) {
          const childDavPath = storagePathToDav(child.path, principal.user.id);
          if (!childDavPath) continue;
          const childResource = folderResource(child, childDavPath);
          entries.push({
            href: childResource.href,
            propstats: buildPropstats(childResource, request, propContext),
          });
        }
        for (const child of children.files) {
          const childDavPath = storagePathToDav(child.path, principal.user.id);
          if (!childDavPath) continue;
          const childResource = fileResource(child, childDavPath);
          entries.push({
            href: childResource.href,
            propstats: buildPropstats(childResource, request, propContext),
          });
        }
      }
      return multistatus(entries);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  /**
   * Accepts the dead properties clients insist on setting and refuses the live
   * ones. Finder and Explorer both PROPPATCH Win32 or Apple timestamps on every
   * save; answering 501 turns each of those into a visible error, so they are
   * reported as applied and dropped. Nothing reads them back.
   */
  app.on("PROPPATCH", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 403);

    try {
      const entry = await service.resolvePath(principal, target.path);
      if (!entry) return context.body(null, 404);
      const locked = lockedResponse(target.path, context.req.header("If"));
      if (locked) return locked;

      const body = await context.req.text();
      const request = parsePropfind(body);
      const isCollection = entry.kind === "folder";
      const href = davHref(mountPath, davPath, isCollection);
      const names = request.mode === "prop" ? request.props : [];
      return multistatus([
        {
          href,
          propstats: [
            {
              status: STATUS_OK,
              props: names.filter((prop) => !PROTECTED_PROPS.has(prop.name)),
            },
            {
              status: STATUS_FORBIDDEN,
              props: names.filter((prop) => PROTECTED_PROPS.has(prop.name)),
            },
          ],
        },
      ]);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on(["GET", "HEAD"], ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target) return context.body(null, 404);
    if (target.kind === "root") return context.body(null, 405);

    try {
      const entry = await service.resolvePath(principal, target.path);
      if (!entry) return context.body(null, 404);
      if (entry.kind === "folder") return context.body(null, 405);
      if (context.req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": entry.file.mimeType ?? "application/octet-stream",
            "Content-Length": String(entry.file.sizeBytes),
            "Accept-Ranges": "bytes",
            ETag: `"${entry.file.checksum}"`,
            "Last-Modified": entry.file.updatedAt.toUTCString(),
          },
        });
      }
      // Goes through download() so a demoted file is served straight off the
      // HDD and queued for promotion, exactly as it is for the web client.
      const response = await service.download(
        principal,
        entry.file.id,
        context.req.raw,
      );
      response.headers.set("ETag", `"${entry.file.checksum}"`);
      response.headers.set("Last-Modified", entry.file.updatedAt.toUTCString());
      return response;
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on("PUT", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 405);

    // Answered as written and dropped: Finder writes one of these beside every
    // file it copies, and a refusal here reads to it as the copy itself failing.
    if (isOsMetadataPath(target.path)) return context.body(null, 201);

    try {
      const locked = lockedResponse(target.path, context.req.header("If"));
      if (locked) return locked;

      const existing = await service.resolvePath(principal, target.path);
      if (existing?.kind === "folder") return context.body(null, 405);

      const parent = await service.resolvePath(
        principal,
        parentPath(target.path),
      );
      if (parent?.kind !== "folder") {
        return context.body(null, 409);
      }
      const filename = target.path.slice(target.path.lastIndexOf("/") + 1);
      const result = await service.putFile(
        principal,
        parent.folder,
        filename,
        context.req.raw,
        "preserve",
      );
      return new Response(null, {
        status: result.created ? 201 : 204,
        headers: { ETag: `"${result.file.checksum}"` },
      });
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on("MKCOL", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 405);

    if (isOsMetadataPath(target.path)) return context.body(null, 201);

    try {
      // RFC 4918 §9.3.1: a body in a MKCOL this server does not understand.
      if ((await context.req.text()).trim().length > 0) {
        return context.body(null, 415);
      }
      const locked = lockedResponse(target.path, context.req.header("If"));
      if (locked) return locked;

      if (await service.resolvePath(principal, target.path)) {
        return context.body(null, 405);
      }
      const parent = await service.resolvePath(
        principal,
        parentPath(target.path),
      );
      if (parent?.kind !== "folder") {
        return context.body(null, 409);
      }
      const name = target.path.slice(target.path.lastIndexOf("/") + 1);
      await service.createFolder(
        principal,
        { name, parentId: parent.folder.id },
        "preserve",
      );
      return context.body(null, 201);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on("DELETE", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 403);

    // Never stored, so nothing to remove — but Finder cleans up after itself
    // and a 404 here makes it report a failure it cannot act on.
    if (isOsMetadataPath(target.path)) return context.body(null, 204);

    try {
      const entry = await service.resolvePath(principal, target.path);
      if (!entry) return context.body(null, 404);

      // A collection DELETE is recursive, so the whole subtree has to be clear,
      // not just the collection itself.
      const locked =
        entry.kind === "folder"
          ? subtreeLockedResponse(target.path, context.req.header("If"))
          : lockedResponse(target.path, context.req.header("If"));
      if (locked) return locked;

      if (entry.kind === "file") {
        await service.deleteFile(principal, entry.file.id);
      } else {
        await service.deleteFolder(principal, entry.folder.id, true);
      }
      locks.releaseSubtree(target.path);
      return context.body(null, 204);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on(["MOVE", "COPY"], ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const isMove = context.req.method === "MOVE";
    const davPath = davPathOf(context.req.url);
    const source = davPathToStorage(davPath, principal.user.id);
    if (!source || source.kind === "root") return context.body(null, 403);

    const destinationHeader = context.req.header("Destination");
    if (!destinationHeader) return context.body(null, 400);
    const destinationDavPath = destinationPath(destinationHeader, mountPath);
    if (!destinationDavPath) return context.body(null, 502);
    const destination = davPathToStorage(destinationDavPath, principal.user.id);
    if (!destination || destination.kind === "root") {
      return context.body(null, 403);
    }
    if (destination.path === source.path) return context.body(null, 403);

    // Neither end was ever stored, so there is nothing to move or copy. Finder
    // relocates the sidecar alongside the file it belongs to and treats a
    // failure here as the whole operation failing.
    if (isOsMetadataPath(source.path) || isOsMetadataPath(destination.path)) {
      return context.body(null, 204);
    }

    const overwrite = (context.req.header("Overwrite") ?? "T").toUpperCase();

    try {
      const ifHeader = context.req.header("If");
      const entry = await service.resolvePath(principal, source.path);
      if (!entry) return context.body(null, 404);

      const destinationParent = await service.resolvePath(
        principal,
        parentPath(destination.path),
      );
      if (destinationParent?.kind !== "folder") {
        return context.body(null, 409);
      }
      if (
        entry.kind === "folder" &&
        destination.path.startsWith(`${source.path}/`)
      ) {
        return context.body(null, 403);
      }

      const existing = await service.resolvePath(principal, destination.path);
      if (existing && overwrite !== "T") return context.body(null, 412);

      // Both ends are checked across their subtrees when a collection is
      // involved, because both are then destroyed or relocated wholesale and a
      // depth-0 lock on one member is invisible from the collection above it.
      const lockedTarget =
        existing?.kind === "folder"
          ? subtreeLockedResponse(destination.path, ifHeader)
          : lockedResponse(destination.path, ifHeader);
      if (lockedTarget) return lockedTarget;
      if (isMove) {
        const lockedSource =
          entry.kind === "folder"
            ? subtreeLockedResponse(source.path, ifHeader)
            : lockedResponse(source.path, ifHeader);
        if (lockedSource) return lockedSource;
      }

      // A file copied onto a file replaces the row and its bytes in a single
      // publish: copyFile stages beside the target and drops the old blob only
      // after the transaction commits, so the destination is never absent and a
      // failure leaves the original intact. Every other overwrite has to clear
      // the destination first — `path` is unique, so the replacement cannot be
      // built alongside it — and a failure after that point has destroyed data
      // the client had. Read a 500 from one of those accordingly.
      const replacesInPlace =
        !isMove && entry.kind === "file" && existing?.kind === "file";
      if (existing && !replacesInPlace) {
        if (existing.kind === "file") {
          await service.deleteFile(principal, existing.file.id);
        } else {
          await service.deleteFolder(principal, existing.folder.id, true);
        }
        locks.releaseSubtree(destination.path);
      }

      const name = destination.path.slice(
        destination.path.lastIndexOf("/") + 1,
      );
      if (isMove) {
        if (entry.kind === "file") {
          await service.updateFile(
            principal,
            entry.file.id,
            { filename: name, folderId: destinationParent.folder.id },
            "preserve",
          );
        } else {
          await service.updateFolder(
            principal,
            entry.folder.id,
            { name, parentId: destinationParent.folder.id },
            "preserve",
          );
        }
        locks.retargetSubtree(source.path, destination.path);
      } else if (entry.kind === "file") {
        await service.copyFile(
          principal,
          entry.file,
          destinationParent.folder,
          name,
          "preserve",
        );
      } else {
        await copyCollection(
          principal,
          entry.folder,
          destinationParent.folder,
          name,
        );
      }
      return context.body(null, existing ? 204 : 201);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  /**
   * Depth-infinity COPY of a collection, breadth-first. There is no bulk copy
   * underneath: each file goes through `copyFile`, which verifies the checksum
   * of every copy it writes.
   *
   * A failure part way through leaves a partially built tree at the
   * destination; nothing unwinds it. When the COPY was also an overwrite the
   * destination it replaced is already gone by this point, so the partial tree
   * is all that is left — see the overwrite comment above.
   *
   * The walk is bounded because it runs on the request thread and writes real
   * bytes: without a ceiling, one COPY of a large home directory holds the
   * handler open indefinitely and can fill the disk with no way to refuse
   * early. Exceeding either ceiling fails with 507 rather than running on.
   */
  async function copyCollection(
    principal: StoragePrincipal,
    source: Folder,
    destinationParent: Folder,
    name: string,
  ): Promise<void> {
    const created = await service.createFolder(
      principal,
      { name, parentId: destinationParent.id },
      "preserve",
    );
    const queue: Array<{ from: Folder; to: Folder }> = [
      { from: source, to: created },
    ];
    let entries = 1;
    let bytes = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const children = await service.listChildren(principal, current.from);
      for (const file of children.files) {
        entries += 1;
        bytes += file.sizeBytes;
        if (entries > copyMaxEntries || bytes > copyMaxBytes) {
          throw new CopyTooLargeError();
        }
        await service.copyFile(
          principal,
          file,
          current.to,
          file.filename,
          "preserve",
        );
      }
      for (const folder of children.folders) {
        entries += 1;
        if (entries > copyMaxEntries) throw new CopyTooLargeError();
        const child = await service.createFolder(
          principal,
          { name: folder.name, parentId: current.to.id },
          "preserve",
        );
        queue.push({ from: folder, to: child });
      }
    }
  }

  app.on("LOCK", ["/", "/*"], async (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 403);

    try {
      const body = await context.req.text();
      const timeoutSeconds = parseTimeoutHeader(context.req.header("Timeout"));

      if (isLockRefresh(body)) {
        const [token] = parseIfHeader(context.req.header("If"));
        const refreshed = token ? locks.refresh(token, timeoutSeconds) : null;
        if (!refreshed) return context.body(null, 412);
        return lockResponse(refreshed, davPath, 200);
      }

      const existing = await service.resolvePath(principal, target.path);
      const blocking = locks.blocking(
        target.path,
        parseIfHeader(context.req.header("If")),
      );
      if (blocking) return context.body(null, 423);

      // Locking a path that holds nothing yet creates a lock-null resource:
      // both Finder and Explorer take a lock before the PUT that creates the
      // file, and refusing here makes the whole save fail.
      if (!existing) {
        const parent = await service.resolvePath(
          principal,
          parentPath(target.path),
        );
        if (parent?.kind !== "folder") {
          return context.body(null, 409);
        }
      }

      const lock = locks.create({
        path: target.path,
        depth: context.req.header("Depth") === "0" ? "0" : "infinity",
        owner: parseLockOwner(body),
        timeoutSeconds,
        userId: principal.user.id,
      });
      return lockResponse(lock, davPath, existing ? 200 : 201);
    } catch (error) {
      return davErrorResponse(error);
    }
  });

  app.on("UNLOCK", ["/", "/*"], (context) => {
    const principal = principalFor(context.get("user"));
    const davPath = davPathOf(context.req.url);
    const target = davPathToStorage(davPath, principal.user.id);
    if (!target || target.kind === "root") return context.body(null, 403);

    const token = parseLockTokenHeader(context.req.header("Lock-Token"));
    if (!token) return context.body(null, 400);

    const lock = locks.get(token);
    // RFC 4918 §9.11: the token has to belong to the resource being unlocked,
    // and 409 is the answer when it does not. Checking the holder as well stops
    // one account releasing a lock another account is relying on — without it
    // `locks.remove` acts on any token a caller can name.
    if (
      !lock ||
      lock.path !== target.path ||
      lock.userId !== principal.user.id
    ) {
      return context.body(null, 409);
    }
    return context.body(null, locks.remove(token) ? 204 : 409);
  });

  function lockResponse(
    lock: ReturnType<DavLockStore["create"]>,
    davPath: string,
    status: 200 | 201,
  ): Response {
    const href = davHref(mountPath, davPath, false);
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<D:prop xmlns:D="DAV:"><D:lockdiscovery>' +
      renderActiveLock(lock, href) +
      "</D:lockdiscovery></D:prop>";
    return new Response(body, {
      status,
      headers: {
        "Content-Type": 'application/xml; charset="utf-8"',
        "Lock-Token": `<${escapeXml(lock.token)}>`,
      },
    });
  }

  return app;
}

function multistatus(entries: DavResponseEntry[]): Response {
  return new Response(buildMultistatus(entries), {
    status: 207,
    headers: { "Content-Type": 'application/xml; charset="utf-8"' },
  });
}
