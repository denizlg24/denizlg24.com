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

export interface DavRoutesOptions {
  service: DavStorage;
  mountPath: string;
  locks?: DavLockStore;
  quota?: () => Promise<{
    usedBytes: number;
    availableBytes: number;
  } | null>;
}

function davErrorResponse(error: unknown): Response {
  if (error instanceof StorageServiceError) {
    return new Response(null, { status: error.status });
  }
  console.error("WebDAV request failed", error);
  return new Response(null, { status: 500 });
}

export function davRoutes(options: DavRoutesOptions) {
  const { service, mountPath } = options;
  const locks = options.locks ?? new DavLockStore();
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

  const propertyContext = async (): Promise<PropertyContext> => {
    const quota = await options.quota?.().catch(() => null);
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
      const propContext = await propertyContext();
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

    try {
      const locked = lockedResponse(target.path, context.req.header("If"));
      if (locked) return locked;

      const entry = await service.resolvePath(principal, target.path);
      if (!entry) return context.body(null, 404);
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

    const overwrite = (context.req.header("Overwrite") ?? "T").toUpperCase();

    try {
      const ifHeader = context.req.header("If");
      const lockedTarget = lockedResponse(destination.path, ifHeader);
      if (lockedTarget) return lockedTarget;
      if (isMove) {
        const lockedSource = lockedResponse(source.path, ifHeader);
        if (lockedSource) return lockedSource;
      }

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
      if (existing) {
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
   * Depth-infinity COPY of a collection, breadth-first so a failure part way
   * through leaves a partial tree rather than an inconsistent one. There is no
   * bulk copy underneath: each file goes through `copyFile`, which verifies the
   * checksum of every copy it writes.
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
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const children = await service.listChildren(principal, current.from);
      for (const file of children.files) {
        await service.copyFile(principal, file, current.to, file.filename);
      }
      for (const folder of children.folders) {
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
