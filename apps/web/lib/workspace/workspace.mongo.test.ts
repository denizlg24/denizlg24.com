import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  BLOCK_TYPES,
  type Block,
  type BlockType,
  pageSchema,
  type Workspace,
  type WorkspaceChanges,
  type WorkspacePage,
  type WorkspacePageDoc,
  type WorkspaceRevisionSummary,
  workspaceAppliedOpSchema,
  workspaceSchema,
} from "@repo/schemas";
import type { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import type { AdminSession } from "@/lib/require-admin";
import { DesktopWorkspace } from "@/models/DesktopWorkspace";
import { WorkspacePageModel } from "@/models/WorkspacePage";
import {
  type IWorkspacePageRevision,
  WorkspacePageRevisionModel,
} from "@/models/WorkspacePageRevision";
import { WorkspacePrefsModel } from "@/models/WorkspacePrefs";
import { mongoWorkspaceRepo } from "./mongo-repo";
import type { WorkspaceRepo } from "./repo";
import {
  createWorkspaceService,
  OWNER,
  SNAPSHOT_EVERY,
  type WorkspaceCaller,
} from "./service";

/*
 * The workspace against a real mongod (mongodb-memory-server), through the
 * Mongoose models, `mongo-repo` and the route handlers. Off by default: the
 * first run downloads a mongod, and `bun test` shares one process across
 * files, so the memory-repo mocks in `route.test.ts` would otherwise leak in.
 * Run it alone: `bun run test:mongo` in apps/web.
 */
const enabled = process.env.WORKSPACE_MONGO_TESTS === "1";
const MONGOD_VERSION = "8.2.1";

const OWNER_SESSION: AdminSession = {
  user: { email: "owner", role: "admin" },
  via: "session",
};
const AGENT_SESSION: AdminSession = {
  user: { email: "client:mcp-svc", role: "admin" },
  via: "oauth",
};
const AGENT_ACTOR = "conversation:c42";
const AGENT: WorkspaceCaller = {
  actor: AGENT_ACTOR,
  via: "mcp:mcp-svc",
  agent: true,
};

let session: AdminSession = OWNER_SESSION;
if (enabled) {
  mock.module("@/lib/require-admin", () => ({
    getAdminSession: mock(async () => session),
  }));
}

const T0 = "2026-10-01T09:00:00.000Z";

function page(
  id: string,
  fields: Partial<WorkspacePage> & { blocks: Block[] },
): WorkspacePage {
  return {
    id,
    title: id,
    icon: null,
    parentId: null,
    order: 0,
    fullWidth: false,
    locked: false,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...fields,
  };
}

/** One block of every type the base commit's `blockSchema` knows. */
function everyBlock(): Block[] {
  const blocks: Block[] = [
    { id: "h1", span: 6, type: "heading", text: "Week" },
    { id: "t1", span: 4, type: "text", markdown: "**bold**\n\n- a\n- b" },
    { id: "d1", span: 6, type: "divider" },
    {
      id: "td1",
      span: 3,
      type: "todo",
      title: "Today",
      items: [
        { id: "i1", text: "milk", done: false },
        { id: "i2", text: "bread", done: true },
      ],
    },
    {
      id: "l1",
      span: 3,
      type: "links",
      refs: ["page:projects", "module:finance"],
    },
    { id: "sp1", span: 6, type: "subpages", title: "" },
    { id: "g1", span: 6, type: "greeting" },
    { id: "st1", span: 2, type: "stats" },
    { id: "ag1", span: 4, type: "agenda" },
    { id: "tk1", span: 3, type: "tasks" },
    { id: "se1", span: 3, type: "semester" },
    { id: "al1", span: 2, type: "alerts" },
    { id: "bu1", span: 2, type: "budget" },
    { id: "re1", span: 2, type: "resources" },
    { id: "ll1", span: 2, type: "llm" },
    { id: "no1", span: 2, type: "notes" },
    { id: "co1", span: 2, type: "contacts" },
    { id: "nw1", span: 2, type: "now" },
    { id: "bo1", span: 6, type: "board" },
    { id: "at1", span: 6, type: "agent", title: "Ask" },
    { id: "mo1", span: 6, type: "modules", sections: ["money", "infra"] },
  ];
  const covered = new Set<BlockType>(blocks.map((b) => b.type));
  for (const type of BLOCK_TYPES) {
    if (!covered.has(type)) throw new Error(`Fixture lacks a ${type} block`);
  }
  return blocks;
}

/** A v1 document as production holds it: nested pages, trash, favorites. */
function legacyWorkspace(): Workspace {
  const pages: WorkspacePage[] = [
    page("home", { title: "Home", icon: "🏠", blocks: everyBlock() }),
    page("projects", {
      title: "Projects",
      order: 1,
      blocks: [{ id: "p-sub", span: 6, type: "subpages" }],
    }),
    page("alpha", {
      title: "Alpha",
      parentId: "projects",
      order: 0,
      fullWidth: true,
      blocks: [
        { id: "a-h", span: 6, type: "heading", text: "Alpha" },
        { id: "a-t", span: 6, type: "text", markdown: "notes" },
      ],
    }),
    page("alpha-log", {
      title: "Log",
      parentId: "alpha",
      order: 0,
      locked: true,
      blocks: [{ id: "log-t", span: 6, type: "text", markdown: "x" }],
    }),
    page("beta", {
      title: "Beta",
      parentId: "projects",
      order: 0.5,
      blocks: [],
    }),
    page("old", {
      title: "Old",
      order: 2,
      deletedAt: "2026-10-20T12:00:00.000Z",
      blocks: [{ id: "o-t", span: 6, type: "text", markdown: "gone" }],
    }),
    page("old-child", {
      title: "Old child",
      parentId: "old",
      deletedAt: "2026-10-20T12:00:00.000Z",
      blocks: [],
    }),
  ];
  return workspaceSchema.parse({
    version: 1,
    savedAt: "2026-10-28T18:30:00.000Z",
    pages: Object.fromEntries(pages.map((p) => [p.id, p])),
    favorites: ["page:alpha", "module:finance"],
    recents: ["page:home", "page:alpha-log", "module:calendar"],
    sidebar: {
      width: 300,
      collapsed: false,
      hiddenModules: ["markets"],
      collapsedSections: ["infra"],
      expandedPages: ["home", "projects", "alpha"],
    },
  });
}

/** Written exactly as the v1 `PUT /workspace` wrote it. */
async function seedLegacy(workspace: Workspace = legacyWorkspace()) {
  await DesktopWorkspace.updateOne(
    { _id: "singleton" },
    { $set: { data: workspace } },
    { upsert: true },
  ).exec();
}

async function reset() {
  await Promise.all([
    DesktopWorkspace.deleteMany({}).exec(),
    WorkspacePageModel.deleteMany({}).exec(),
    WorkspacePageRevisionModel.deleteMany({}).exec(),
    WorkspacePrefsModel.deleteMany({}).exec(),
  ]);
}

/** Seeds the v1 document and migrates it with a service of its own. */
async function migrated(workspace?: Workspace) {
  await seedLegacy(workspace);
  const service = createWorkspaceService(mongoWorkspaceRepo);
  await service.ensureMigrated();
  return service;
}

async function storedPage(id: string) {
  return WorkspacePageModel.findById(id).lean().exec();
}

async function revisionsOf(id: string) {
  return WorkspacePageRevisionModel.find({ pageId: id })
    .sort({ rev: 1 })
    .lean()
    .exec();
}

const BASE = "http://localhost/api/admin/workspace";

type Routes = Awaited<ReturnType<typeof loadRoutes>>;
async function loadRoutes() {
  return {
    workspace: await import("@/app/api/admin/workspace/route"),
    pages: await import("@/app/api/admin/workspace/pages/route"),
    page: await import("@/app/api/admin/workspace/pages/[id]/route"),
    ops: await import("@/app/api/admin/workspace/pages/[id]/ops/route"),
    archive: await import("@/app/api/admin/workspace/pages/[id]/archive/route"),
    restore: await import("@/app/api/admin/workspace/pages/[id]/restore/route"),
    revert: await import("@/app/api/admin/workspace/pages/[id]/revert/route"),
    changes: await import("@/app/api/admin/workspace/changes/route"),
  };
}

function request(
  path: string,
  init: { method?: string; body?: object; actor?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.actor) headers["x-agent-actor"] = init.actor;
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface ConflictBody {
  code: string;
  conflicts?: string[];
  page?: WorkspacePageDoc;
}

describe.skipIf(!enabled)("workspace on a real mongod", () => {
  let server: MongoMemoryServer;
  let routes: Routes;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    server = await MongoMemoryServer.create({
      binary: { version: MONGOD_VERSION },
    });
    const uri = server.getUri("workspace-test");
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
      throw new Error(`Refusing a non-local mongod: ${uri}`);
    }
    await mongoose.connect(uri);
    // `connectDB` reuses a cached connection; point it at this one so a
    // route can never reach whatever MONGODB_URI names.
    const cache = global.mongooseCache ?? { conn: null, promise: null };
    cache.conn = mongoose;
    cache.promise = Promise.resolve(mongoose);
    global.mongooseCache = cache;
    await Promise.all(
      [
        DesktopWorkspace,
        WorkspacePageModel,
        WorkspacePageRevisionModel,
        WorkspacePrefsModel,
      ].map((model) => model.init()),
    );
    routes = await loadRoutes();
  }, 600_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    session = OWNER_SESSION;
    await reset();
  });

  describe("indexes", () => {
    test("syncIndexes creates the unique (pageId, rev) and changedAt indexes", async () => {
      await WorkspacePageRevisionModel.collection.drop().catch(() => {});
      await WorkspacePageModel.collection.drop().catch(() => {});
      await WorkspacePageRevisionModel.syncIndexes();
      await WorkspacePageModel.syncIndexes();

      const revisionIndexes =
        await WorkspacePageRevisionModel.collection.indexes();
      const unique = revisionIndexes.find((i) => i.name === "pageId_1_rev_1");
      expect(unique?.unique).toBe(true);
      expect(unique?.key).toEqual({ pageId: 1, rev: 1 });
      const pageIndexes = await WorkspacePageModel.collection.indexes();
      expect(pageIndexes.map((i) => i.name)).toContain("changedAt_1");

      const revision: IWorkspacePageRevision = {
        pageId: "p",
        rev: 1,
        actor: "owner",
        via: null,
        kind: "create",
        at: new Date(),
        ops: [],
        inverse: [],
        touched: [],
        snapshot: null,
      };
      await WorkspacePageRevisionModel.create(revision);
      await expect(
        WorkspacePageRevisionModel.create(revision),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe("migration from DesktopWorkspace", () => {
    test("splits a realistic v1 document into pages, revisions and prefs", async () => {
      const legacy = legacyWorkspace();
      await seedLegacy(legacy);
      const before = await DesktopWorkspace.findById("singleton").lean().exec();

      await createWorkspaceService(mongoWorkspaceRepo).ensureMigrated();

      const ids = Object.keys(legacy.pages).sort();
      const docs = await WorkspacePageModel.find().sort({ _id: 1 }).lean();
      expect(docs.map((d) => d._id)).toEqual(ids);
      for (const doc of docs) {
        const expected = legacy.pages[doc._id];
        const { _id, rev, changedAt, purgedAt, compatBase, ...fields } = doc;
        // Strict: a field Mongo turned into null or dropped fails here.
        expect(pageSchema.strict().parse({ ...fields, id: _id })).toEqual(
          expected as WorkspacePage,
        );
        expect(rev).toBe(1);
        expect(changedAt).toBeInstanceOf(Date);
        expect(purgedAt).toBeNull();
        expect(compatBase).toBeNull();
      }
      const home = await storedPage("home");
      expect(home?.blocks.map((b) => b.type).sort()).toEqual(
        [...BLOCK_TYPES].sort(),
      );

      const revisions = await WorkspacePageRevisionModel.find().lean();
      expect(revisions).toHaveLength(ids.length);
      for (const revision of revisions) {
        expect(revision.rev).toBe(1);
        expect(revision.kind).toBe("migrate");
        expect(revision.snapshot).toEqual(
          legacy.pages[revision.pageId] as WorkspacePage,
        );
      }

      const prefs = await WorkspacePrefsModel.findById("singleton").lean();
      expect(prefs?.favorites).toEqual(legacy.favorites);
      expect(prefs?.recents).toEqual(legacy.recents);
      expect(prefs?.sidebar).toEqual(legacy.sidebar);
      expect(prefs?.migratedFrom).toBe("2026-10-28T18:30:00.000Z");

      const after = await DesktopWorkspace.findById("singleton").lean().exec();
      expect(after).toEqual(before);
    });

    test("a second run, and a fresh process, change nothing", async () => {
      await migrated();
      const pages = await WorkspacePageModel.find().sort({ _id: 1 }).lean();
      const prefs = await WorkspacePrefsModel.findById("singleton").lean();

      await createWorkspaceService(mongoWorkspaceRepo).ensureMigrated();
      const again = createWorkspaceService(mongoWorkspaceRepo);
      await again.ensureMigrated();
      await again.ensureMigrated();

      expect(await WorkspacePageModel.find().sort({ _id: 1 }).lean()).toEqual(
        pages,
      );
      expect(await WorkspacePageRevisionModel.countDocuments()).toBe(
        pages.length,
      );
      expect(await WorkspacePrefsModel.findById("singleton").lean()).toEqual(
        prefs,
      );
    });

    test("two concurrent migrations finish with one copy of everything", async () => {
      await seedLegacy();
      const services = Array.from({ length: 4 }, () =>
        createWorkspaceService(mongoWorkspaceRepo),
      );
      await Promise.all(services.map((s) => s.ensureMigrated()));

      const count = Object.keys(legacyWorkspace().pages).length;
      expect(await WorkspacePageModel.countDocuments()).toBe(count);
      expect(await WorkspacePageRevisionModel.countDocuments()).toBe(count);
      expect(await WorkspacePrefsModel.countDocuments()).toBe(1);
      for (const doc of await WorkspacePageModel.find().lean()) {
        expect(doc.rev).toBe(1);
      }
    });

    test("a run that died before prefs is finished by the next one", async () => {
      await seedLegacy();
      let inserted = 0;
      const dying: WorkspaceRepo = {
        ...mongoWorkspaceRepo,
        async insertPage(p) {
          if (++inserted > 3) throw new Error("container killed");
          return mongoWorkspaceRepo.insertPage(p);
        },
      };
      await expect(
        createWorkspaceService(dying).ensureMigrated(),
      ).rejects.toThrow("container killed");
      expect(await WorkspacePageModel.countDocuments()).toBe(3);
      expect(await WorkspacePrefsModel.countDocuments()).toBe(0);

      await createWorkspaceService(mongoWorkspaceRepo).ensureMigrated();
      expect(await WorkspacePageModel.countDocuments()).toBe(
        Object.keys(legacyWorkspace().pages).length,
      );
      expect(await WorkspacePrefsModel.countDocuments()).toBe(1);
    });

    test("no v1 document migrates to defaults", async () => {
      await createWorkspaceService(mongoWorkspaceRepo).ensureMigrated();
      expect(await WorkspacePageModel.countDocuments()).toBe(0);
      const prefs = await WorkspacePrefsModel.findById("singleton").lean();
      expect(prefs?.migratedFrom).toBeNull();
      expect(prefs?.sidebar.expandedPages).toEqual(["home"]);
    });

    test("the routes serve the migrated pages", async () => {
      await migrated();
      const response = await routes.pages.GET(request("/pages"));
      expect(response.status).toBe(200);
      const { pages } = (await response.json()) as {
        pages: { id: string; rev: number; blockCount: number }[];
      };
      expect(pages.find((p) => p.id === "home")?.blockCount).toBe(
        BLOCK_TYPES.length,
      );
      const one = await routes.page.GET(
        request("/pages/alpha"),
        params("alpha"),
      );
      const body = (await one.json()) as { page: WorkspacePageDoc };
      expect(body.page.blocks).toEqual(
        legacyWorkspace().pages.alpha?.blocks ?? [],
      );
    });
  });

  describe("ops and the rev compare-and-set", () => {
    const post = (id: string, body: object, actor?: string) =>
      routes.ops.POST(
        request(`/pages/${id}/ops`, { method: "POST", body, actor }),
        params(id),
      );

    test("racing batches on different blocks rebase; on the same block one gets 409", async () => {
      await migrated();
      const [first, second] = await Promise.all([
        post("alpha", {
          baseRev: 1,
          ops: [{ op: "update", id: "a-h", set: { text: "Alpha!" } }],
        }),
        post("alpha", {
          baseRev: 1,
          ops: [{ op: "update", id: "a-t", set: { markdown: "edited" } }],
        }),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);
      const doc = await storedPage("alpha");
      expect(doc?.rev).toBe(3);
      expect(doc?.blocks).toEqual([
        { id: "a-h", span: 6, type: "heading", text: "Alpha!" },
        { id: "a-t", span: 6, type: "text", markdown: "edited" },
      ]);
      expect((await revisionsOf("alpha")).map((r) => r.rev)).toEqual([1, 2, 3]);

      const racing = await Promise.all([
        post("alpha", {
          baseRev: 3,
          ops: [{ op: "update", id: "a-t", set: { markdown: "mine" } }],
        }),
        post("alpha", {
          baseRev: 3,
          ops: [{ op: "update", id: "a-t", set: { markdown: "theirs" } }],
        }),
      ]);
      const statuses = racing.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const loser = racing.find((r) => r.status === 409);
      const body = (await loser?.json()) as ConflictBody;
      expect(body.code).toBe("CONFLICT");
      expect(body.conflicts).toEqual(["a-t"]);
      expect(body.page?.rev).toBe(4);
      expect((await storedPage("alpha"))?.rev).toBe(4);
      expect(
        await WorkspacePageRevisionModel.countDocuments({ pageId: "alpha" }),
      ).toBe(4);
    });

    test("five concurrent inserts all land, each on its own rev", async () => {
      await migrated();
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          post("beta", {
            baseRev: 1,
            ops: [
              {
                op: "insert",
                block: { id: `n${i}`, span: 6, type: "text", markdown: `${i}` },
              },
            ],
          }),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const doc = await storedPage("beta");
      expect(doc?.rev).toBe(6);
      expect(doc?.blocks.map((b) => b.id).sort()).toEqual([
        "n0",
        "n1",
        "n2",
        "n3",
        "n4",
      ]);
      const revisions = await revisionsOf("beta");
      expect(revisions.map((r) => r.rev)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const revision of revisions.slice(1)) {
        // Stored ops must still be valid applied ops, anchors concrete.
        for (const op of revision.ops) {
          const parsed = workspaceAppliedOpSchema.parse(op);
          if (parsed.op === "insert") expect(parsed.after).not.toBeUndefined();
        }
      }
    });

    test("a deleted anchor on rebase is a conflict, not a misplaced block", async () => {
      await migrated();
      expect(
        (
          await post("alpha", {
            baseRev: 1,
            ops: [{ op: "delete", id: "a-h" }],
          })
        ).status,
      ).toBe(200);
      const stale = await post("alpha", {
        baseRev: 1,
        ops: [
          {
            op: "insert",
            block: { id: "x", span: 6, type: "divider" },
            after: "a-h",
          },
        ],
      });
      expect(stale.status).toBe(409);
      expect((await storedPage("alpha"))?.rev).toBe(2);
    });
  });

  describe("insert-only upserts", () => {
    test("creating an existing id is 409 and leaves the stored page alone", async () => {
      await migrated();
      const before = await storedPage("alpha");
      const response = await routes.pages.POST(
        request("/pages", {
          method: "POST",
          body: { id: "alpha", title: "Clobber" },
        }),
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as ConflictBody).code).toBe("EXISTS");
      expect(await storedPage("alpha")).toEqual(before);
      expect(
        await WorkspacePageRevisionModel.countDocuments({ pageId: "alpha" }),
      ).toBe(1);
    });

    test("two clients creating the same id: one 201, one 409, one revision", async () => {
      await migrated();
      const create = (title: string) =>
        routes.pages.POST(
          request("/pages", {
            method: "POST",
            body: {
              id: "fresh",
              title,
              blocks: [{ id: "b", span: 6, type: "text", markdown: title }],
            },
          }),
        );
      const responses = await Promise.all([create("one"), create("two")]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const doc = await storedPage("fresh");
      const revisions = await revisionsOf("fresh");
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.snapshot?.title).toBe(doc?.title ?? "");
    });

    test("the repo's insertPage never overwrites", async () => {
      await migrated();
      const before = await storedPage("home");
      if (!before) throw new Error("home missing");
      const { _id, ...rest } = before;
      const inserted = await mongoWorkspaceRepo.insertPage({
        ...rest,
        id: _id,
        title: "Overwritten",
        rev: 99,
      });
      expect(inserted).toBe(false);
      expect(await storedPage("home")).toEqual(before);
    });
  });

  describe("tombstones and the change feed", () => {
    test("archive then purge reports the page in `purged`, keeps a tombstone, drops history", async () => {
      const service = await migrated();
      const start = (await service.changes(null)).cursor;

      session = OWNER_SESSION;
      const archived = await routes.archive.POST(
        request("/pages/alpha/archive", { method: "POST" }),
        params("alpha"),
      );
      expect(archived.status).toBe(200);
      const purged = await routes.page.DELETE(
        request("/pages/alpha", { method: "DELETE" }),
        params("alpha"),
      );
      expect(purged.status).toBe(200);
      expect(
        ((await purged.json()) as { purged: string[] }).purged.sort(),
      ).toEqual(["alpha", "alpha-log"]);

      const tombstone = await storedPage("alpha");
      expect(tombstone?.purgedAt).toBeInstanceOf(Date);
      expect(tombstone?.blocks).toEqual([]);
      expect(
        await WorkspacePageRevisionModel.countDocuments({ pageId: "alpha" }),
      ).toBe(0);

      const feed = await routes.changes.GET(
        request(`/changes?since=${encodeURIComponent(start)}`),
      );
      const changes = (await feed.json()) as WorkspaceChanges;
      expect(changes.purged.sort()).toEqual(["alpha", "alpha-log"]);
      expect(changes.pages.map((p) => p.id)).not.toContain("alpha");

      const gone = await routes.page.GET(
        request("/pages/alpha"),
        params("alpha"),
      );
      expect(gone.status).toBe(404);
      const list = (await (
        await routes.pages.GET(request("/pages"))
      ).json()) as {
        pages: { id: string }[];
      };
      expect(list.pages.map((p) => p.id)).not.toContain("alpha");
      const recreate = await routes.pages.POST(
        request("/pages", { method: "POST", body: { id: "alpha" } }),
      );
      expect(recreate.status).toBe(409);
    });

    test("each poll sees what landed after the previous cursor, including skewed writes", async () => {
      await seedLegacy();
      let clock = Date.parse("2026-10-29T10:00:00.000Z");
      const service = createWorkspaceService(mongoWorkspaceRepo, {
        now: () => new Date(clock),
      });
      await service.ensureMigrated();

      clock += 10_000;
      const first = await service.changes(null);
      expect(first.pages.map((p) => p.id).sort()).toEqual(
        Object.keys(legacyWorkspace().pages).sort(),
      );

      clock += 10_000;
      const quiet = await service.changes(first.cursor);
      expect(quiet.pages).toEqual([]);

      clock += 1_000;
      await service.applyOps(
        "beta",
        {
          baseRev: 1,
          ops: [{ op: "insert", block: { id: "q", span: 6, type: "divider" } }],
        },
        OWNER,
      );
      // Another container, its clock two seconds behind, writes just after
      // this poll's cursor was taken.
      const poll = await service.changes(quiet.cursor);
      expect(poll.pages.map((p) => p.id)).toEqual(["beta"]);
      const skewed = createWorkspaceService(mongoWorkspaceRepo, {
        now: () => new Date(clock - 2_000),
      });
      await skewed.updateMeta("projects", { title: "Projects!" }, OWNER);

      clock += 1_000;
      const next = await service.changes(poll.cursor);
      expect(next.pages.map((p) => p.id)).toContain("projects");
    });

    test("trash older than 30 days is purged on listing and reported as purged", async () => {
      await seedLegacy();
      let clock = Date.parse("2026-11-25T00:00:00.000Z");
      const service = createWorkspaceService(mongoWorkspaceRepo, {
        now: () => new Date(clock),
      });
      await service.ensureMigrated();
      const cursor = (await service.changes(null)).cursor;
      clock += 1_000;
      const live = await service.listPages();
      expect(live.map((p) => p.id)).not.toContain("old");
      clock += 1_000;
      const feed = await service.changes(cursor);
      expect(feed.purged.sort()).toEqual(["old", "old-child"]);
    });
  });

  describe("revert", () => {
    test("revert to a rev across a snapshot boundary rebuilds that rev exactly", async () => {
      const service = await migrated();
      const states = new Map<number, WorkspacePageDoc>();
      states.set(1, await service.getPage("home"));
      let current = await service.getPage("home");
      for (let i = 0; current.rev < SNAPSHOT_EVERY + 5; i++) {
        const blocks = current.blocks;
        const step =
          i % 4 === 0
            ? {
                op: "insert" as const,
                block: {
                  id: `r${i}`,
                  span: 2 as const,
                  type: "text" as const,
                  markdown: `${i}`,
                },
                after: i % 8 === 0 ? null : undefined,
              }
            : i % 4 === 1
              ? {
                  op: "move" as const,
                  id: blocks[blocks.length - 1]?.id ?? "h1",
                  after: null,
                }
              : i % 4 === 2
                ? {
                    op: "update" as const,
                    id: "td1",
                    set: { title: `T${i}` },
                  }
                : { op: "delete" as const, id: blocks[3]?.id ?? "d1" };
        current = await service.applyOps(
          "home",
          { baseRev: current.rev, ops: [step] },
          i % 2 === 0 ? OWNER : AGENT,
        );
        states.set(current.rev, current);
      }
      const snapshots = await WorkspacePageRevisionModel.find({
        pageId: "home",
        snapshot: { $ne: null },
      })
        .sort({ rev: 1 })
        .lean();
      expect(snapshots.map((s) => s.rev)).toEqual([1, SNAPSHOT_EVERY]);

      for (const target of [SNAPSHOT_EVERY + 3, SNAPSHOT_EVERY - 1, 7, 1]) {
        const reverted = await service.revertToRev("home", target, OWNER);
        expect(reverted.blocks).toEqual(states.get(target)?.blocks ?? []);
        expect(reverted.title).toBe(states.get(target)?.title ?? "");
        const fromDb = await storedPage("home");
        expect(fromDb?.blocks).toEqual(reverted.blocks);
      }
    });

    test("reverting an actor skips what the owner touched afterwards", async () => {
      const service = await migrated();
      let doc = await service.applyOps(
        "alpha",
        {
          baseRev: 1,
          ops: [
            { op: "update", id: "a-t", set: { markdown: "agent text" } },
            {
              op: "insert",
              block: { id: "ag", span: 6, type: "text", markdown: "agent" },
            },
            { op: "update", id: "a-h", set: { text: "Agent heading" } },
          ],
        },
        AGENT,
      );
      doc = await service.applyOps(
        "alpha",
        {
          baseRev: doc.rev,
          ops: [{ op: "update", id: "a-h", set: { text: "Owner heading" } }],
        },
        OWNER,
      );

      session = OWNER_SESSION;
      const response = await routes.revert.POST(
        request("/pages/alpha/revert", {
          method: "POST",
          body: { actor: AGENT_ACTOR },
        }),
        params("alpha"),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        page: WorkspacePageDoc;
        reverted: number;
        skipped: number;
      };
      expect(body.skipped).toBe(1);
      expect(body.reverted).toBe(2);
      expect(body.page.blocks).toEqual([
        { id: "a-h", span: 6, type: "heading", text: "Owner heading" },
        { id: "a-t", span: 6, type: "text", markdown: "notes" },
      ]);
      const last = (await revisionsOf("alpha")).at(-1);
      expect(last?.kind).toBe("revert");
      expect(last?.snapshot?.blocks).toEqual(body.page.blocks);
    });

    test("history pages back through stored revisions", async () => {
      const service = await migrated();
      let doc = await service.getPage("beta");
      for (let i = 0; i < 4; i++) {
        doc = await service.updateMeta("beta", { title: `b${i}` }, AGENT);
      }
      const all = await service.history("beta", { limit: 2 });
      expect(all.map((r: WorkspaceRevisionSummary) => r.rev)).toEqual([5, 4]);
      expect(all[0]?.actor).toBe(AGENT_ACTOR);
      expect(all[0]?.via).toBe("mcp:mcp-svc");
      const older = await service.history("beta", { limit: 10, before: 4 });
      expect(older.map((r) => r.rev)).toEqual([3, 2, 1]);
      expect(doc.rev).toBe(5);
    });
  });

  describe("desktop 3.0.0 compatibility", () => {
    async function compatGet(): Promise<Workspace> {
      const response = await routes.workspace.GET(request(""));
      expect(response.status).toBe(200);
      return ((await response.json()) as { workspace: Workspace }).workspace;
    }

    async function compatPut(workspace: Workspace) {
      session = OWNER_SESSION;
      return routes.workspace.PUT(
        request("", { method: "PUT", body: workspace }),
      );
    }

    test("a stale PUT keeps a concurrent agent edit and applies its own", async () => {
      await migrated();
      const held = await compatGet();
      const base = await storedPage("alpha");
      expect(base?.compatBase).toEqual(held.pages.alpha as WorkspacePage);

      session = AGENT_SESSION;
      const agentEdit = await routes.ops.POST(
        request("/pages/alpha/ops", {
          method: "POST",
          actor: AGENT_ACTOR,
          body: {
            baseRev: 1,
            ops: [{ op: "update", id: "a-h", set: { text: "Agent" } }],
          },
        }),
        params("alpha"),
      );
      expect(agentEdit.status).toBe(200);

      const alpha = held.pages.alpha;
      if (!alpha) throw new Error("alpha missing");
      const edited: Workspace = {
        ...held,
        pages: {
          ...held.pages,
          alpha: {
            ...alpha,
            title: "Alpha (desktop)",
            blocks: alpha.blocks.map((b) =>
              b.id === "a-t" && b.type === "text"
                ? { ...b, markdown: "desktop text" }
                : b,
            ),
          },
        },
        favorites: [...held.favorites, "page:beta"],
      };
      expect((await compatPut(edited)).status).toBe(200);

      const doc = await storedPage("alpha");
      expect(doc?.title).toBe("Alpha (desktop)");
      expect(doc?.blocks).toEqual([
        { id: "a-h", span: 6, type: "heading", text: "Agent" },
        { id: "a-t", span: 6, type: "text", markdown: "desktop text" },
      ]);
      const revisions = await revisionsOf("alpha");
      expect(revisions.map((r) => [r.rev, r.actor, r.kind])).toEqual([
        [1, "owner", "migrate"],
        [2, AGENT_ACTOR, "ops"],
        [3, "owner", "compat"],
      ]);
      expect(doc?.compatBase).toEqual(edited.pages.alpha as WorkspacePage);
      const prefs = await WorkspacePrefsModel.findById("singleton").lean();
      expect(prefs?.favorites).toEqual([
        "page:alpha",
        "module:finance",
        "page:beta",
      ]);

      // The same block edited on both sides: the stored copy wins.
      const again = await compatGet();
      session = AGENT_SESSION;
      await routes.ops.POST(
        request("/pages/alpha/ops", {
          method: "POST",
          actor: AGENT_ACTOR,
          body: {
            baseRev: 3,
            ops: [{ op: "update", id: "a-t", set: { markdown: "agent wins" } }],
          },
        }),
        params("alpha"),
      );
      const againAlpha = again.pages.alpha;
      if (!againAlpha) throw new Error("alpha missing");
      await compatPut({
        ...again,
        pages: {
          ...again.pages,
          alpha: {
            ...againAlpha,
            blocks: againAlpha.blocks.map((b) =>
              b.id === "a-t" && b.type === "text"
                ? { ...b, markdown: "desktop loses" }
                : b,
            ),
          },
        },
      });
      const after = await storedPage("alpha");
      expect(after?.blocks[1]).toEqual({
        id: "a-t",
        span: 6,
        type: "text",
        markdown: "agent wins",
      });
      expect(after?.rev).toBe(4);
    });

    test("a page missing from the PUT is purged only when trashed and unchanged", async () => {
      await migrated();
      const held = await compatGet();
      const {
        old: _old,
        "old-child": _child,
        beta: _beta,
        ...kept
      } = held.pages;
      expect((await compatPut({ ...held, pages: kept })).status).toBe(200);
      expect((await storedPage("old"))?.purgedAt).toBeInstanceOf(Date);
      expect((await storedPage("old-child"))?.purgedAt).toBeInstanceOf(Date);
      // Not trashed: dropping it from a PUT does nothing.
      expect((await storedPage("beta"))?.purgedAt).toBeNull();
    });

    test("a page 3.0.0 created offline is inserted once", async () => {
      await migrated();
      const held = await compatGet();
      const created = page("desk", {
        title: "From desktop",
        blocks: [{ id: "dk", span: 6, type: "text", markdown: "hi" }],
      });
      const body = { ...held, pages: { ...held.pages, desk: created } };
      await Promise.all([compatPut(body), compatPut(body)]);
      const doc = await storedPage("desk");
      expect(doc?.rev).toBe(1);
      expect(doc?.blocks).toEqual(created.blocks);
      expect(
        await WorkspacePageRevisionModel.countDocuments({ pageId: "desk" }),
      ).toBe(1);
    });
  });

  describe("locked pages", () => {
    test("a non-owner actor gets 423 on every write; the owner does not", async () => {
      await migrated();
      session = AGENT_SESSION;
      const ops = await routes.ops.POST(
        request("/pages/alpha-log/ops", {
          method: "POST",
          actor: AGENT_ACTOR,
          body: {
            baseRev: 1,
            ops: [{ op: "update", id: "log-t", set: { markdown: "agent" } }],
          },
        }),
        params("alpha-log"),
      );
      expect(ops.status).toBe(423);
      expect(((await ops.json()) as ConflictBody).code).toBe("LOCKED");

      const unlock = await routes.page.PATCH(
        request("/pages/alpha-log", {
          method: "PATCH",
          body: { locked: false },
        }),
        params("alpha-log"),
      );
      expect(unlock.status).toBe(423);

      const revert = await routes.revert.POST(
        request("/pages/alpha-log/revert", {
          method: "POST",
          body: { rev: 1 },
        }),
        params("alpha-log"),
      );
      expect(revert.status).toBe(423);

      const stored = await storedPage("alpha-log");
      expect(stored?.rev).toBe(1);
      expect(stored?.locked).toBe(true);

      session = OWNER_SESSION;
      const owner = await routes.ops.POST(
        request("/pages/alpha-log/ops", {
          method: "POST",
          body: {
            baseRev: 1,
            ops: [{ op: "update", id: "log-t", set: { markdown: "owner" } }],
          },
        }),
        params("alpha-log"),
      );
      expect(owner.status).toBe(200);
    });

    test("an agent cannot trash or purge a locked page through an unlocked ancestor", async () => {
      await migrated();
      session = AGENT_SESSION;
      const archive = await routes.archive.POST(
        request("/pages/alpha/archive", { method: "POST", actor: AGENT_ACTOR }),
        params("alpha"),
      );
      expect(archive.status).toBe(423);
      // Refused whole: nothing above the locked page was trashed either.
      expect((await storedPage("alpha"))?.deletedAt).toBeNull();
      expect((await storedPage("alpha"))?.rev).toBe(1);
      expect((await storedPage("alpha-log"))?.deletedAt).toBeNull();

      session = OWNER_SESSION;
      expect(
        (
          await routes.archive.POST(
            request("/pages/alpha/archive", { method: "POST" }),
            params("alpha"),
          )
        ).status,
      ).toBe(200);
      session = AGENT_SESSION;
      const purge = await routes.page.DELETE(
        request("/pages/alpha", { method: "DELETE", actor: AGENT_ACTOR }),
        params("alpha"),
      );
      expect(purge.status).toBe(423);
      expect((await storedPage("alpha"))?.purgedAt).toBeNull();
      expect((await storedPage("alpha-log"))?.purgedAt).toBeNull();
      expect(
        await WorkspacePageRevisionModel.countDocuments({
          pageId: "alpha-log",
        }),
      ).toBe(2);

      const restore = await routes.restore.POST(
        request("/pages/alpha/restore", { method: "POST", actor: AGENT_ACTOR }),
        params("alpha"),
      );
      expect(restore.status).toBe(423);
      expect((await storedPage("alpha"))?.deletedAt).not.toBeNull();
      expect((await storedPage("alpha-log"))?.deletedAt).not.toBeNull();
    });
  });
});
