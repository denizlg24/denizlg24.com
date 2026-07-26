import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import type { Folder, StorageFile } from "../db/schema";
import type { SafeUserRecord } from "../services/types";
import type { StoragePrincipal } from "../storage/access";
import { joinPath, parentPath } from "../storage/path";
import {
  type NamingPolicy,
  type StorageEntry,
  StorageServiceError,
} from "../storage/service";
import { DavLockStore } from "./locks";
import { type DavStorage, type DavVariables, davRoutes } from "./routes";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const MOUNT = "/dav";
const HOME = `/${USER_ID}`;

const user = {
  id: USER_ID,
  username: "owner",
  email: "owner@example.com",
  role: "user",
  status: "active",
  totpEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
} satisfies SafeUserRecord;

/**
 * In-memory stand-in for StorageService, keyed on path exactly as the real
 * unique indexes are. It implements only the operations the router reaches for.
 */
class FakeStorage implements DavStorage {
  readonly folders = new Map<string, Folder>();
  readonly files = new Map<string, StorageFile>();
  #nextId = 1;

  constructor() {
    this.#addFolder(HOME, USER_ID, null);
    this.#addFolder("/shared", "shared", null);
  }

  #id(): string {
    const value = String(this.#nextId).padStart(12, "0");
    this.#nextId += 1;
    return `20000000-0000-4000-8000-${value}`;
  }

  #addFolder(path: string, name: string, parentId: string | null): Folder {
    const folder: Folder = {
      id: this.#id(),
      ownerId: path === "/shared" ? null : USER_ID,
      parentId,
      path,
      name,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    this.folders.set(path, folder);
    return folder;
  }

  addFile(path: string, content: string): StorageFile {
    const parent = this.folders.get(parentPath(path));
    if (!parent) throw new Error(`missing parent for ${path}`);
    const file: StorageFile = {
      id: this.#id(),
      ownerId: USER_ID,
      folderId: parent.id,
      filename: path.slice(path.lastIndexOf("/") + 1),
      path,
      mimeType: "text/plain",
      sizeBytes: content.length,
      checksum: `sum-${content.length}`,
      tier: "ssd",
      diskPath: `/ssd${path}`,
      lastAccessedAt: new Date("2026-01-02T00:00:00Z"),
      accessCount: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    this.files.set(path, file);
    this.contents.set(file.id, content);
    return file;
  }

  readonly contents = new Map<string, string>();

  async roots(): Promise<unknown> {
    return {};
  }

  async resolvePath(
    _principal: StoragePrincipal,
    path: string,
  ): Promise<StorageEntry | null> {
    const folder = this.folders.get(path);
    if (folder) return { kind: "folder", folder };
    const file = this.files.get(path);
    if (file) return { kind: "file", file };
    return null;
  }

  async listChildren(
    _principal: StoragePrincipal,
    folder: Folder,
  ): Promise<{ folders: Folder[]; files: StorageFile[] }> {
    return {
      folders: [...this.folders.values()].filter(
        (candidate) => candidate.parentId === folder.id,
      ),
      files: [...this.files.values()].filter(
        (candidate) => candidate.folderId === folder.id,
      ),
    };
  }

  async download(_principal: StoragePrincipal, id: string): Promise<Response> {
    return new Response(this.contents.get(id) ?? "", { status: 200 });
  }

  /** Every naming policy the router passed, in call order. */
  readonly namingCalls: Array<NamingPolicy | undefined> = [];
  /** Set to make the next copyFile fail, as a full disk would. */
  copyFileFails = false;

  async putFile(
    _principal: StoragePrincipal,
    parent: Folder,
    filename: string,
    request: Request,
    naming?: NamingPolicy,
  ): Promise<{ file: StorageFile; created: boolean }> {
    this.namingCalls.push(naming);
    const path = joinPath(parent.path, filename);
    const created = !this.files.has(path);
    const body = await request.text();
    this.files.delete(path);
    const file = this.addFile(path, body);
    return { file, created };
  }

  async copyFile(
    _principal: StoragePrincipal,
    file: StorageFile,
    parent: Folder,
    filename: string,
    naming?: NamingPolicy,
  ): Promise<{ file: StorageFile; created: boolean }> {
    this.namingCalls.push(naming);
    if (this.copyFileFails) throw new Error("no space left on device");
    const path = joinPath(parent.path, filename);
    const created = !this.files.has(path);
    const copy = this.addFile(path, this.contents.get(file.id) ?? "");
    return { file: copy, created };
  }

  async createFolder(
    _principal: StoragePrincipal,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<Folder> {
    this.namingCalls.push(naming);
    const input = body as { name: string; parentId: string };
    const parent = [...this.folders.values()].find(
      (candidate) => candidate.id === input.parentId,
    );
    if (!parent) {
      throw new StorageServiceError(404, "PARENT_NOT_FOUND", "missing parent");
    }
    return this.#addFolder(
      joinPath(parent.path, input.name),
      input.name,
      parent.id,
    );
  }

  async updateFile(
    _principal: StoragePrincipal,
    id: string,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<unknown> {
    this.namingCalls.push(naming);
    const input = body as { filename: string; folderId: string };
    const file = [...this.files.values()].find(
      (candidate) => candidate.id === id,
    );
    const parent = [...this.folders.values()].find(
      (candidate) => candidate.id === input.folderId,
    );
    if (!file || !parent) throw new Error("bad move");
    this.files.delete(file.path);
    const moved = {
      ...file,
      filename: input.filename,
      folderId: parent.id,
      path: joinPath(parent.path, input.filename),
    };
    this.files.set(moved.path, moved);
    return moved;
  }

  async updateFolder(
    _principal: StoragePrincipal,
    id: string,
    body: unknown,
    naming?: NamingPolicy,
  ): Promise<unknown> {
    this.namingCalls.push(naming);
    const input = body as { name: string; parentId: string };
    const folder = [...this.folders.values()].find(
      (candidate) => candidate.id === id,
    );
    const parent = [...this.folders.values()].find(
      (candidate) => candidate.id === input.parentId,
    );
    if (!folder || !parent) throw new Error("bad move");
    this.folders.delete(folder.path);
    const moved = {
      ...folder,
      name: input.name,
      parentId: parent.id,
      path: joinPath(parent.path, input.name),
    };
    this.folders.set(moved.path, moved);
    return moved;
  }

  async deleteFile(_principal: StoragePrincipal, id: string): Promise<void> {
    for (const [path, file] of this.files) {
      if (file.id === id) this.files.delete(path);
    }
  }

  async deleteFolder(
    _principal: StoragePrincipal,
    id: string,
  ): Promise<{ deletedFolders: number; deletedFiles: number }> {
    const root = [...this.folders.values()].find(
      (candidate) => candidate.id === id,
    );
    if (!root) {
      throw new StorageServiceError(404, "FOLDER_NOT_FOUND", "missing folder");
    }
    // Recursive, like the real one: a fake that removed only the named row
    // would let a broken recursive DELETE pass, and leaves the locked-member
    // case impossible to write.
    const covers = (path: string) =>
      path === root.path || path.startsWith(`${root.path}/`);
    let deletedFolders = 0;
    let deletedFiles = 0;
    for (const [path] of this.folders) {
      if (covers(path)) {
        this.folders.delete(path);
        deletedFolders += 1;
      }
    }
    for (const [path, file] of this.files) {
      if (covers(path)) {
        this.files.delete(path);
        this.contents.delete(file.id);
        deletedFiles += 1;
      }
    }
    return { deletedFolders, deletedFiles };
  }
}

let storage: FakeStorage;
let app: Hono<{ Variables: DavVariables }>;
let locks: DavLockStore;

function buildApp(
  overrides: { copyMaxEntries?: number; copyMaxBytes?: number } = {},
): Hono<{ Variables: DavVariables }> {
  const root = new Hono<{ Variables: DavVariables }>();
  root.use(`${MOUNT}/*`, async (context, next) => {
    context.set("user", user);
    return next();
  });
  root.use(MOUNT, async (context, next) => {
    context.set("user", user);
    return next();
  });
  root.route(
    MOUNT,
    davRoutes({
      service: storage,
      mountPath: MOUNT,
      locks,
      quota: async () => ({ usedBytes: 100, availableBytes: 900 }),
      ...overrides,
    }),
  );
  return root;
}

function propfind(path: string, depth: string, body = "") {
  return app.request(path, {
    method: "PROPFIND",
    headers: { Depth: depth },
    body: body || undefined,
  });
}

beforeEach(() => {
  storage = new FakeStorage();
  locks = new DavLockStore();
  app = buildApp();
});

describe("OPTIONS", () => {
  it("advertises the class and methods clients gate on", async () => {
    const response = await app.request(`${MOUNT}/home`, { method: "OPTIONS" });
    expect(response.status).toBe(200);
    // Finder mounts read-only without Class 2; Explorer needs MS-Author-Via.
    expect(response.headers.get("DAV")).toBe("1, 2");
    expect(response.headers.get("MS-Author-Via")).toBe("DAV");
    expect(response.headers.get("Allow")).toContain("PROPFIND");
    expect(response.headers.get("Allow")).toContain("LOCK");
  });
});

describe("PROPFIND", () => {
  it("lists the two aliases under the mount root", async () => {
    const response = await propfind(MOUNT, "1");
    expect(response.status).toBe(207);
    const xml = await response.text();
    expect(xml).toContain("<D:href>/dav/</D:href>");
    expect(xml).toContain("<D:href>/dav/home/</D:href>");
    expect(xml).toContain("<D:href>/dav/shared/</D:href>");
  });

  it("reports depth 0 without children", async () => {
    const response = await propfind(MOUNT, "0");
    const xml = await response.text();
    expect(xml).toContain("<D:href>/dav/</D:href>");
    expect(xml).not.toContain("/dav/home/");
  });

  it("marks collections with a trailing slash and files without", async () => {
    storage.addFile(`${HOME}/report.txt`, "hello");
    const response = await propfind(`${MOUNT}/home`, "1");
    const xml = await response.text();
    expect(xml).toContain("<D:href>/dav/home/</D:href>");
    expect(xml).toContain("<D:href>/dav/home/report.txt</D:href>");
    expect(xml).toContain("<D:getcontentlength>5</D:getcontentlength>");
  });

  it("refuses depth infinity with the documented precondition", async () => {
    const response = await propfind(`${MOUNT}/home`, "infinity");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("propfind-finite-depth");
  });

  it("reports unknown properties as 404 instead of failing the response", async () => {
    storage.addFile(`${HOME}/report.txt`, "hello");
    const response = await propfind(
      `${MOUNT}/home/report.txt`,
      "0",
      '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">' +
        "<D:prop><D:getcontentlength/><Z:Win32FileAttributes/></D:prop>" +
        "</D:propfind>",
    );
    const xml = await response.text();
    expect(response.status).toBe(207);
    expect(xml).toContain("<D:status>HTTP/1.1 200 OK</D:status>");
    expect(xml).toContain("<D:status>HTTP/1.1 404 Not Found</D:status>");
    expect(xml).toContain("Win32FileAttributes");
  });

  it("reports quota on collections so Finder can draw capacity", async () => {
    const xml = await (await propfind(`${MOUNT}/home`, "0")).text();
    expect(xml).toContain("<D:quota-used-bytes>100</D:quota-used-bytes>");
    expect(xml).toContain(
      "<D:quota-available-bytes>900</D:quota-available-bytes>",
    );
  });

  it("404s a path outside the aliases", async () => {
    expect((await propfind(`${MOUNT}/elsewhere`, "0")).status).toBe(404);
  });
});

describe("GET and HEAD", () => {
  it("returns the body for GET and only headers for HEAD", async () => {
    storage.addFile(`${HOME}/report.txt`, "hello");
    const get = await app.request(`${MOUNT}/home/report.txt`);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("hello");

    const head = await app.request(`${MOUNT}/home/report.txt`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("5");
    expect(head.headers.get("ETag")).toBe('"sum-5"');
  });

  it("405s a GET of a collection", async () => {
    expect((await app.request(`${MOUNT}/home`)).status).toBe(405);
  });
});

describe("PUT", () => {
  it("creates with 201 and replaces with 204", async () => {
    const created = await app.request(`${MOUNT}/home/note.txt`, {
      method: "PUT",
      body: "one",
    });
    expect(created.status).toBe(201);

    const replaced = await app.request(`${MOUNT}/home/note.txt`, {
      method: "PUT",
      body: "two",
    });
    expect(replaced.status).toBe(204);
    expect(storage.files.get(`${HOME}/note.txt`)?.sizeBytes).toBe(3);
  });

  it("preserves the name the client wrote to", async () => {
    const response = await app.request(`${MOUNT}/home/My%20Report.PDF`, {
      method: "PUT",
      body: "x",
    });
    expect(response.status).toBe(201);
    // Snake-casing here would 404 the client's very next request. Asserting on
    // the policy the router passed and not only on the stored name: the service
    // defaults to "normalize", so an omitted argument is a real bug that the
    // stored-name check alone would not catch.
    expect(storage.namingCalls).toEqual(["preserve"]);
    expect(storage.files.has(`${HOME}/My Report.PDF`)).toBe(true);
  });

  it("409s when the parent collection does not exist", async () => {
    const response = await app.request(`${MOUNT}/home/missing/note.txt`, {
      method: "PUT",
      body: "x",
    });
    expect(response.status).toBe(409);
  });

  it("405s a PUT over a collection", async () => {
    const response = await app.request(`${MOUNT}/home`, {
      method: "PUT",
      body: "x",
    });
    expect(response.status).toBe(405);
  });
});

describe("MKCOL", () => {
  it("creates a collection", async () => {
    const response = await app.request(`${MOUNT}/home/docs`, {
      method: "MKCOL",
    });
    expect(response.status).toBe(201);
    expect(storage.folders.has(`${HOME}/docs`)).toBe(true);
  });

  it("405s when the collection already exists", async () => {
    await app.request(`${MOUNT}/home/docs`, { method: "MKCOL" });
    const response = await app.request(`${MOUNT}/home/docs`, {
      method: "MKCOL",
    });
    expect(response.status).toBe(405);
  });

  it("415s a MKCOL carrying a body", async () => {
    const response = await app.request(`${MOUNT}/home/docs`, {
      method: "MKCOL",
      body: "<D:mkcol/>",
    });
    expect(response.status).toBe(415);
  });

  it("409s when the parent is missing", async () => {
    const response = await app.request(`${MOUNT}/home/a/b`, {
      method: "MKCOL",
    });
    expect(response.status).toBe(409);
  });
});

describe("DELETE", () => {
  it("removes a file", async () => {
    storage.addFile(`${HOME}/report.txt`, "hello");
    const response = await app.request(`${MOUNT}/home/report.txt`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect(storage.files.has(`${HOME}/report.txt`)).toBe(false);
  });

  it("403s a delete of the mount root", async () => {
    expect((await app.request(MOUNT, { method: "DELETE" })).status).toBe(403);
  });
});

describe("MOVE and COPY", () => {
  it("moves a file and reports 201 for a fresh destination", async () => {
    storage.addFile(`${HOME}/a.txt`, "hello");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/dav/home/b.txt" },
    });
    expect(response.status).toBe(201);
    expect(storage.files.has(`${HOME}/b.txt`)).toBe(true);
    expect(storage.files.has(`${HOME}/a.txt`)).toBe(false);
  });

  it("412s when the destination exists and Overwrite is F", async () => {
    storage.addFile(`${HOME}/a.txt`, "one");
    storage.addFile(`${HOME}/b.txt`, "two");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "MOVE",
      headers: {
        Destination: "http://localhost/dav/home/b.txt",
        Overwrite: "F",
      },
    });
    expect(response.status).toBe(412);
  });

  it("overwrites and reports 204 when Overwrite is allowed", async () => {
    storage.addFile(`${HOME}/a.txt`, "one");
    storage.addFile(`${HOME}/b.txt`, "two");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/dav/home/b.txt" },
    });
    expect(response.status).toBe(204);
  });

  it("refuses to move a collection into its own descendant", async () => {
    await app.request(`${MOUNT}/home/dir`, { method: "MKCOL" });
    const response = await app.request(`${MOUNT}/home/dir`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/dav/home/dir/inner" },
    });
    expect(response.status).toBe(403);
  });

  it("copies a file", async () => {
    storage.addFile(`${HOME}/a.txt`, "hello");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "COPY",
      headers: { Destination: "http://localhost/dav/home/b.txt" },
    });
    expect(response.status).toBe(201);
    expect(storage.files.has(`${HOME}/a.txt`)).toBe(true);
    expect(storage.files.has(`${HOME}/b.txt`)).toBe(true);
  });

  it("502s a Destination pointing outside the mount", async () => {
    storage.addFile(`${HOME}/a.txt`, "hello");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/elsewhere/b.txt" },
    });
    expect(response.status).toBe(502);
  });
});

describe("LOCK and UNLOCK", () => {
  it("takes a null lock on a path that does not exist yet", async () => {
    const response = await app.request(`${MOUNT}/home/new.txt`, {
      method: "LOCK",
      headers: { Timeout: "Second-120" },
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>deniz</D:owner></D:lockinfo>',
    });
    // 201 is what tells the client the lock-null resource was created; both
    // Finder and Explorer LOCK before the PUT that creates a file.
    expect(response.status).toBe(201);
    const token = response.headers.get("Lock-Token");
    expect(token).toMatch(/^<opaquelocktoken:/);
    expect(await response.text()).toContain(
      "<D:timeout>Second-120</D:timeout>",
    );
  });

  it("blocks a write without the token and admits one with it", async () => {
    const lock = await app.request(`${MOUNT}/home/new.txt`, {
      method: "LOCK",
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>deniz</D:owner></D:lockinfo>',
    });
    const token = lock.headers.get("Lock-Token") ?? "";

    const blocked = await app.request(`${MOUNT}/home/new.txt`, {
      method: "PUT",
      body: "x",
    });
    expect(blocked.status).toBe(423);

    const allowed = await app.request(`${MOUNT}/home/new.txt`, {
      method: "PUT",
      headers: { If: `(${token})` },
      body: "x",
    });
    expect(allowed.status).toBe(201);
  });

  it("refreshes on an empty body and releases on UNLOCK", async () => {
    const lock = await app.request(`${MOUNT}/home/new.txt`, {
      method: "LOCK",
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>deniz</D:owner></D:lockinfo>',
    });
    const header = lock.headers.get("Lock-Token") ?? "";
    const token = header.slice(1, -1);

    const refreshed = await app.request(`${MOUNT}/home/new.txt`, {
      method: "LOCK",
      headers: { If: `(<${token}>)`, Timeout: "Second-300" },
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.text()).toContain("Second-300");

    const unlocked = await app.request(`${MOUNT}/home/new.txt`, {
      method: "UNLOCK",
      headers: { "Lock-Token": header },
    });
    expect(unlocked.status).toBe(204);

    const after = await app.request(`${MOUNT}/home/new.txt`, {
      method: "PUT",
      body: "x",
    });
    expect(after.status).toBe(201);
  });

  it("409s an UNLOCK of a token it never issued", async () => {
    const response = await app.request(`${MOUNT}/home/new.txt`, {
      method: "UNLOCK",
      headers: { "Lock-Token": "<opaquelocktoken:nope>" },
    });
    expect(response.status).toBe(409);
  });

  it("409s an UNLOCK whose token belongs to another resource", async () => {
    const lock = await app.request(`${MOUNT}/home/a.txt`, {
      method: "LOCK",
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>deniz</D:owner></D:lockinfo>',
    });
    const header = lock.headers.get("Lock-Token") ?? "";

    // RFC 4918 §9.11: the token has to belong to the request-URI.
    const wrongPath = await app.request(`${MOUNT}/home/b.txt`, {
      method: "UNLOCK",
      headers: { "Lock-Token": header },
    });
    expect(wrongPath.status).toBe(409);

    const rightPath = await app.request(`${MOUNT}/home/a.txt`, {
      method: "UNLOCK",
      headers: { "Lock-Token": header },
    });
    expect(rightPath.status).toBe(204);
  });

  it("409s an UNLOCK of a lock held by another account", async () => {
    const held = locks.create({
      path: `${HOME}/a.txt`,
      depth: "0",
      owner: "someone else",
      timeoutSeconds: 600,
      userId: "20000000-0000-4000-8000-000000000009",
    });

    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "UNLOCK",
      headers: { "Lock-Token": `<${held.token}>` },
    });
    expect(response.status).toBe(409);
    expect(locks.get(held.token)).not.toBeNull();
  });
});

describe("naming policy", () => {
  it("asks for the client's spelling on every write verb", async () => {
    storage.addFile(`${HOME}/a.txt`, "hello");
    await app.request(`${MOUNT}/home/Docs`, { method: "MKCOL" });
    await app.request(`${MOUNT}/home/a.txt`, {
      method: "COPY",
      headers: { Destination: "http://localhost/dav/home/B.txt" },
    });
    await app.request(`${MOUNT}/home/a.txt`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/dav/home/C.txt" },
    });
    await app.request(`${MOUNT}/home/D.txt`, { method: "PUT", body: "x" });

    expect(storage.namingCalls).toHaveLength(4);
    expect(storage.namingCalls.every((policy) => policy === "preserve")).toBe(
      true,
    );
  });
});

describe("recursive DELETE", () => {
  it("removes descendants", async () => {
    await app.request(`${MOUNT}/home/dir`, { method: "MKCOL" });
    await app.request(`${MOUNT}/home/dir/sub`, { method: "MKCOL" });
    storage.addFile(`${HOME}/dir/a.txt`, "one");
    storage.addFile(`${HOME}/dir/sub/b.txt`, "two");

    const response = await app.request(`${MOUNT}/home/dir`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect(storage.folders.has(`${HOME}/dir/sub`)).toBe(false);
    expect(storage.files.has(`${HOME}/dir/a.txt`)).toBe(false);
    expect(storage.files.has(`${HOME}/dir/sub/b.txt`)).toBe(false);
  });

  it("refuses when a descendant is locked by someone else's token", async () => {
    await app.request(`${MOUNT}/home/dir`, { method: "MKCOL" });
    storage.addFile(`${HOME}/dir/a.txt`, "one");
    // A depth-0 lock on a member is invisible from the collection above it, so
    // the plain `covering` check would let this recursive delete through.
    const lock = await app.request(`${MOUNT}/home/dir/a.txt`, {
      method: "LOCK",
      headers: { Depth: "0" },
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>other</D:owner></D:lockinfo>',
    });
    // 200, not 201: the file already exists, so this is not a lock-null.
    expect(lock.status).toBe(200);

    const blocked = await app.request(`${MOUNT}/home/dir`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(423);
    expect(storage.files.has(`${HOME}/dir/a.txt`)).toBe(true);

    const token = lock.headers.get("Lock-Token") ?? "";
    const allowed = await app.request(`${MOUNT}/home/dir`, {
      method: "DELETE",
      headers: { If: `(${token})` },
    });
    expect(allowed.status).toBe(204);
  });

  it("refuses an overwriting MOVE onto a collection with a locked member", async () => {
    storage.addFile(`${HOME}/src.txt`, "one");
    await app.request(`${MOUNT}/home/dst`, { method: "MKCOL" });
    storage.addFile(`${HOME}/dst/held.txt`, "two");
    await app.request(`${MOUNT}/home/dst/held.txt`, {
      method: "LOCK",
      headers: { Depth: "0" },
      body: '<D:lockinfo xmlns:D="DAV:"><D:owner>other</D:owner></D:lockinfo>',
    });

    const response = await app.request(`${MOUNT}/home/src.txt`, {
      method: "MOVE",
      headers: { Destination: "http://localhost/dav/home/dst" },
    });
    expect(response.status).toBe(423);
    expect(storage.files.has(`${HOME}/dst/held.txt`)).toBe(true);
  });
});

describe("overwrite safety", () => {
  it("keeps the destination when a replacing COPY fails", async () => {
    storage.addFile(`${HOME}/a.txt`, "source");
    storage.addFile(`${HOME}/b.txt`, "destination");
    storage.copyFileFails = true;

    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "COPY",
      headers: { Destination: "http://localhost/dav/home/b.txt" },
    });
    expect(response.status).toBe(500);
    // A file copied onto a file replaces in one publish, so a failure must not
    // have already destroyed what was there.
    expect(storage.files.has(`${HOME}/b.txt`)).toBe(true);
  });

  it("bounds a recursive COPY with 507", async () => {
    app = buildApp({ copyMaxEntries: 3 });
    await app.request(`${MOUNT}/home/dir`, { method: "MKCOL" });
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      storage.addFile(`${HOME}/dir/${name}`, "x");
    }

    const response = await app.request(`${MOUNT}/home/dir`, {
      method: "COPY",
      headers: { Destination: "http://localhost/dav/home/copy" },
    });
    expect(response.status).toBe(507);
  });
});

describe("PROPPATCH", () => {
  it("accepts dead properties and refuses protected live ones", async () => {
    storage.addFile(`${HOME}/a.txt`, "hello");
    const response = await app.request(`${MOUNT}/home/a.txt`, {
      method: "PROPPATCH",
      body:
        '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">' +
        "<D:set><D:prop><Z:Win32LastModifiedTime/><D:getcontentlength/>" +
        "</D:prop></D:set></D:propertyupdate>",
    });
    expect(response.status).toBe(207);
    const xml = await response.text();
    expect(xml).toContain("Win32LastModifiedTime");
    expect(xml).toContain("<D:status>HTTP/1.1 200 OK</D:status>");
    expect(xml).toContain("<D:status>HTTP/1.1 403 Forbidden</D:status>");
  });
});
