import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import {
  SURFACE_ERRORS_MAX,
  SURFACE_STATE_MAX_BYTES,
  surfaceSourceRequestSchema,
} from "@repo/schemas";
import type { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { WorkspaceCaller } from "./service";

mock.module("server-only", () => ({}));
const uploads: string[] = [];
mock.module("@/lib/storage-api", () => ({
  uploadFileToStorage: async (file: File) => {
    uploads.push(file.name);
    return { publicUrl: `https://files.test/${uploads.length}-${file.name}` };
  },
}));
const { OWNER, WorkspaceError } = await import("./service");
const {
  addSurfaceAsset,
  appendSurfaceErrors,
  clearSurfaceErrors,
  createSurface,
  deleteSurface,
  getSurface,
  listSurfaces,
  removeSurfaceAsset,
  revertSurface,
  setSurfaceState,
  shapeCallResult,
  surfaceHistory,
  surfaceSource,
  updateSurface,
} = await import("./surfaces");

/*
 * Surfaces against a real mongod. Off by default like the other mongo suites;
 * `bun run test:mongo`.
 */

const enabled = process.env.WORKSPACE_MONGO_TESTS === "1";
const MONGOD_VERSION = "8.2.1";

const agent: WorkspaceCaller = {
  actor: "conversation:abc",
  via: "mcp:x",
  agent: true,
};

async function rejects(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceError);
    if (error instanceof WorkspaceError) expect(error.status).toBe(status);
    return;
  }
  throw new Error("expected a rejection");
}

describe("call result shaping", () => {
  test("structuredContent wins over text", () => {
    expect(
      shapeCallResult({
        content: [{ type: "text", text: '{"a":1}' }],
        structuredContent: { b: 2 },
      }),
    ).toEqual({ isError: false, result: { b: 2 } });
  });

  test("text parses as JSON when it can, else stays text", () => {
    expect(
      shapeCallResult({ content: [{ type: "text", text: '{"a":1}' }] }),
    ).toEqual({ isError: false, result: { a: 1 } });
    expect(
      shapeCallResult({
        isError: true,
        content: [{ type: "text", text: "boom" }],
      }),
    ).toEqual({ isError: true, result: "boom" });
  });
});

describe.skipIf(!enabled)("surfaces on a real mongod", () => {
  let server: MongoMemoryReplSet;

  beforeAll(async () => {
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: MONGOD_VERSION },
    });
    const uri = server.getUri("surfaces-test");
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
      throw new Error(`Refusing a non-local mongod: ${uri}`);
    }
    await mongoose.connect(uri);
    const cache = global.mongooseCache ?? { conn: null, promise: null };
    cache.conn = mongoose;
    cache.promise = Promise.resolve(mongoose);
    global.mongooseCache = cache;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  test("create writes rev 1; code edits bump rev and clear errors; mount-only does not", async () => {
    const surface = await createSurface(
      { name: "Board", html: "<b>1</b>" },
      agent,
    );
    expect(surface.rev).toBe(1);
    expect(surface.createdBy).toBe("conversation:abc");
    await appendSurfaceErrors(surface.id, [{ message: "oops" }]);

    const edited = await updateSurface(surface.id, { html: "<b>2</b>" }, OWNER);
    expect(edited.rev).toBe(2);
    expect(edited.errors).toEqual([]);

    const same = await updateSurface(surface.id, { html: "<b>2</b>" }, OWNER);
    expect(same.rev).toBe(2);

    await appendSurfaceErrors(surface.id, [{ message: "again" }]);
    const mounted = await updateSurface(
      surface.id,
      { mount: { kind: "home" } },
      OWNER,
    );
    expect(mounted.rev).toBe(2);
    expect(mounted.mount).toEqual({ kind: "home" });
    expect(mounted.errors).toHaveLength(1);

    const history = await surfaceHistory(surface.id);
    expect(history.map((r) => r.rev)).toEqual([2, 1]);
    expect(history[0]?.changed).toEqual(["html"]);
    expect(history[0]?.actor).toBe("owner");
  });

  test("a mount has one holder", async () => {
    const a = await createSurface(
      { name: "A", mount: { kind: "module", module: "notes" } },
      OWNER,
    );
    const b = await createSurface({ name: "B" }, OWNER);
    await updateSurface(
      b.id,
      { mount: { kind: "module", module: "notes" } },
      OWNER,
    );
    expect((await getSurface(a.id)).mount).toEqual({ kind: "none" });
    expect((await getSurface(b.id)).mount).toEqual({
      kind: "module",
      module: "notes",
    });
    const c = await createSurface(
      { name: "C", mount: { kind: "home" } },
      OWNER,
    );
    const home = (await listSurfaces()).filter((s) => s.mount.kind === "home");
    expect(home.map((s) => s.id)).toEqual([c.id]);
  });

  test("source edits are atomic revisions with bounded reads and compact conflicts", async () => {
    const s = await createSurface(
      { name: "Source", js: "let count = 1;", css: "body { color: red; }" },
      OWNER,
    );
    const run = (input: unknown) =>
      surfaceSource(s.id, surfaceSourceRequestSchema.parse(input), agent);
    await appendSurfaceErrors(s.id, [{ message: "old" }]);
    const edited = await run({
      action: "source_edit",
      baseRev: 1,
      edits: [
        { field: "js", oldText: "count = 1", newText: "count = 2" },
        { field: "css", oldText: "red", newText: "blue" },
      ],
    });
    expect(edited).toEqual({
      id: s.id,
      rev: 2,
      changed: ["css", "js"],
      editCount: 2,
    });
    expect((await getSurface(s.id)).errors).toEqual([]);
    const history = await surfaceHistory(s.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      actor: agent.actor,
      changed: ["css", "js"],
    });
    expect(
      await run({ action: "source_read", field: "js", maxChars: 3 }),
    ).toMatchObject({ rev: 2, text: "let", nextOffset: 3 });
    expect(await run({ action: "source_search", query: "blue" })).toMatchObject(
      { rev: 2, matches: [{ field: "css", line: 1 }] },
    );
    await rejects(
      run({
        action: "source_edit",
        baseRev: 2,
        edits: [
          { field: "js", oldText: "count = 2", newText: "count = 3" },
          { field: "css", oldText: "missing", newText: "white" },
        ],
      }),
      422,
    );
    expect((await getSurface(s.id)).js).toBe("let count = 2;");
    expect((await getSurface(s.id)).rev).toBe(2);
    try {
      await run({
        action: "source_edit",
        baseRev: 1,
        edits: [{ field: "js", oldText: "count = 2", newText: "count = 3" }],
      });
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      if (error instanceof WorkspaceError)
        expect(error.details).toEqual({ id: s.id, rev: 2 });
    }
    await revertSurface(s.id, 1, OWNER);
    expect((await getSurface(s.id)).js).toBe("let count = 1;");
  });

  test("source imports store fetched bytes atomically and reject failed, oversized or invalid downloads", async () => {
    const s = await createSurface(
      { name: "Import", js: "old", css: "old" },
      OWNER,
    );
    const unfurl = await import("./unfurl");
    const downloads = new Map<string, { bytes: Buffer; status?: number }>([
      ["app.js", { bytes: Buffer.from("console.log('imported')") }],
      ["app.css", { bytes: Buffer.from("body { color: blue; }") }],
      ["bad.js", { bytes: Buffer.from([0xff]) }],
      ["large.js", { bytes: Buffer.alloc(512_001, 97) }],
      ["huge.js", { bytes: Buffer.alloc(512_000 * 4 + 1, 97) }],
      ["missing.js", { bytes: Buffer.from("missing"), status: 404 }],
    ]);
    const fetch = spyOn(unfurl, "fetchGuarded").mockImplementation(
      async (raw) => {
        const url = new URL(raw);
        const download = downloads.get(url.pathname.slice(1));
        if (!download) throw new Error("unavailable signed URL");
        const response = Readable.from([download.bytes]) as IncomingMessage;
        response.statusCode = download.status ?? 200;
        return { response, url };
      },
    );
    const run = (baseRev: number, files: [string, string][]) =>
      surfaceSource(
        s.id,
        surfaceSourceRequestSchema.parse({
          action: "source_import",
          baseRev,
          sources: files.map(([field, file]) => ({
            field,
            sourceUrl: `https://files.test/${file}?signature=secret`,
          })),
        }),
        agent,
      );
    try {
      for (const [file, status] of [
        ["bad.js", 422],
        ["large.js", 413],
        ["huge.js", 413],
        ["missing.js", 502],
        ["absent.js", 502],
      ] as const) {
        await rejects(
          run(1, [
            ["css", "app.css"],
            ["js", file],
          ]),
          status,
        );
        expect(await getSurface(s.id)).toMatchObject({
          rev: 1,
          css: "old",
          js: "old",
        });
        expect(await surfaceHistory(s.id)).toHaveLength(1);
      }
      expect(
        await run(1, [
          ["js", "app.js"],
          ["css", "app.css"],
        ]),
      ).toEqual({
        id: s.id,
        rev: 2,
        changed: ["css", "js"],
        importedCount: 2,
      });
      downloads.clear();
      expect((await getSurface(s.id)).js).toBe("console.log('imported')");
      expect(await surfaceHistory(s.id)).toHaveLength(2);
      fetch.mockImplementationOnce(async (raw) => {
        await updateSurface(s.id, { js: "concurrent edit" }, OWNER);
        const response = Readable.from([
          Buffer.from("stale import"),
        ]) as IncomingMessage;
        response.statusCode = 200;
        return { response, url: new URL(raw) };
      });
      try {
        await run(2, [["js", "app.js"]]);
        throw new Error("expected conflict during download");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceError);
        if (error instanceof WorkspaceError) {
          expect(error.status).toBe(409);
          expect(error.details).toEqual({ id: s.id, rev: 3 });
        }
      }
      expect((await getSurface(s.id)).js).toBe("concurrent edit");
      await revertSurface(s.id, 1, OWNER);
      expect((await getSurface(s.id)).js).toBe("old");
    } finally {
      fetch.mockRestore();
    }
    await rejects(
      surfaceSource(
        s.id,
        surfaceSourceRequestSchema.parse({
          action: "source_import",
          baseRev: 4,
          sources: [{ field: "js", sourceUrl: "https://127.0.0.1/private.js" }],
        }),
        agent,
      ),
      422,
    );
  });

  test("revert restores a snapshot as a new rev", async () => {
    const s = await createSurface({ name: "R", js: "one()" }, OWNER);
    await updateSurface(s.id, { js: "two()", name: "R2" }, OWNER);
    const reverted = await revertSurface(s.id, 1, agent);
    expect(reverted.rev).toBe(3);
    expect(reverted.js).toBe("one()");
    expect(reverted.name).toBe("R");
    const [latest] = await surfaceHistory(s.id, 1);
    expect(latest?.actor).toBe("conversation:abc");
    await rejects(revertSurface(s.id, 99, OWNER), 404);
  });

  test("errors keep the newest, and clear", async () => {
    const s = await createSurface({ name: "E" }, OWNER);
    const batch = Array.from({ length: SURFACE_ERRORS_MAX }, (_, i) => ({
      message: `m${i}`,
    }));
    await appendSurfaceErrors(s.id, batch);
    const errors = await appendSurfaceErrors(s.id, [{ message: "last" }]);
    expect(errors).toHaveLength(SURFACE_ERRORS_MAX);
    expect(errors.at(-1)?.message).toBe("last");
    expect(errors[0]?.message).toBe("m1");
    expect(errors[0]?.at).toBeTruthy();
    await clearSurfaceErrors(s.id);
    expect((await getSurface(s.id)).errors).toEqual([]);
  });

  test("a stale baseRev is a 409 carrying the current surface", async () => {
    const s = await createSurface({ name: "C1", html: "a" }, OWNER);
    await updateSurface(s.id, { html: "b", baseRev: 1 }, OWNER);
    try {
      await updateSurface(s.id, { html: "c", baseRev: 1 }, OWNER);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      if (error instanceof WorkspaceError) {
        expect(error.status).toBe(409);
        expect(error.details.surface).toMatchObject({ rev: 2, html: "b" });
      }
    }
    expect((await getSurface(s.id)).html).toBe("b");
  });

  test("concurrent edits never lose a revision or 500", async () => {
    const s = await createSurface({ name: "C2" }, OWNER);
    const outcomes = await Promise.allSettled(
      ["x", "y", "z"].map((html) => updateSurface(s.id, { html }, OWNER)),
    );
    const won = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(won).toBeGreaterThanOrEqual(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(WorkspaceError);
        expect(outcome.reason.status).toBe(409);
      }
    }
    const surface = await getSurface(s.id);
    expect(surface.rev).toBe(1 + won);
    expect(await surfaceHistory(s.id)).toHaveLength(1 + won);
  });

  test("errors from an older rev are dropped; errorCount lists them", async () => {
    const s = await createSurface({ name: "E2", html: "a" }, OWNER);
    await updateSurface(s.id, { html: "b" }, OWNER);
    const dropped = await appendSurfaceErrors(s.id, [{ message: "old" }], 1);
    expect(dropped).toEqual([]);
    const kept = await appendSurfaceErrors(s.id, [{ message: "new" }], 2);
    expect(kept.map((e) => e.message)).toEqual(["new"]);
    const row = (await listSurfaces()).find((x) => x.id === s.id);
    expect(row?.errorCount).toBe(1);
    expect(row).not.toHaveProperty("html");
  });

  test("a stale baseRev is a 409 even when only the mount changes", async () => {
    const s = await createSurface({ name: "C3", html: "a" }, OWNER);
    await updateSurface(s.id, { html: "b" }, OWNER);
    await rejects(
      updateSurface(
        s.id,
        { html: "b", mount: { kind: "home" }, baseRev: 1 },
        OWNER,
      ),
      409,
    );
    const ok = await updateSurface(
      s.id,
      { mount: { kind: "none" }, baseRev: 2 },
      OWNER,
    );
    expect(ok.rev).toBe(2);
  });

  test("assets: add, replace by name, remove", async () => {
    const s = await createSurface({ name: "A1" }, OWNER);
    const data = Buffer.from("hello").toString("base64");
    await addSurfaceAsset(s.id, {
      name: "a.txt",
      contentType: "text/plain",
      dataBase64: data,
    });
    const second = await addSurfaceAsset(s.id, {
      name: "b.txt",
      contentType: "text/plain",
      dataBase64: data,
    });
    expect(second.surface.assets.map((a) => a.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
    const replaced = await addSurfaceAsset(s.id, {
      name: "a.txt",
      contentType: "text/plain",
      dataBase64: Buffer.from("hello!!").toString("base64"),
    });
    expect(replaced.surface.assets).toHaveLength(2);
    expect(replaced.surface.assets.find((a) => a.name === "a.txt")?.size).toBe(
      7,
    );
    const removed = await removeSurfaceAsset(s.id, "a.txt");
    expect(removed.assets.map((a) => a.name)).toEqual(["b.txt"]);
  });

  test("state is validated by size", async () => {
    const s = await createSurface({ name: "S" }, OWNER);
    expect(await setSurfaceState(s.id, { n: 1 })).toEqual({ n: 1 });
    expect((await getSurface(s.id)).state).toEqual({ n: 1 });
    await rejects(
      setSurfaceState(s.id, { big: "x".repeat(SURFACE_STATE_MAX_BYTES) }),
      400,
    );
  });

  test("delete removes the revisions; assets 404 when absent", async () => {
    const s = await createSurface({ name: "D" }, OWNER);
    await rejects(removeSurfaceAsset(s.id, "nope.png"), 404);
    await deleteSurface(s.id);
    await rejects(getSurface(s.id), 404);
    await rejects(surfaceHistory(s.id), 404);
  });
});
