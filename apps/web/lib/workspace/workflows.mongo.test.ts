import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Block, RichText } from "@repo/schemas";
import { findBlock } from "@repo/utils/workspace-tree";
import type { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { AgentTask } from "@/models/AgentTask";
import { AgentTaskRun } from "@/models/AgentTaskRun";
import { WorkspacePageModel } from "@/models/WorkspacePage";
import { WorkspacePageRevisionModel } from "@/models/WorkspacePageRevision";
import { WorkspacePrefsModel } from "@/models/WorkspacePrefs";
import { OWNER, WorkspaceError } from "./service";

/*
 * Workflows against a real mongod (mongodb-memory-server): templates through
 * the Mongo repo, agent sections' write/propose rule, and event triggers'
 * loop protection, rate limit and auto-disable. Off by default like the other
 * mongo suites; `bun run test:mongo` in apps/web runs it alone.
 */
const enabled = process.env.WORKSPACE_MONGO_TESTS === "1";
const MONGOD_VERSION = "8.2.1";

const runs = (text: string): RichText => [{ type: "text", text }];
const para = (id: string, text: string): Block => ({
  id,
  type: "paragraph",
  text: runs(text),
});

async function workspace() {
  const { workspaceService } = await import("./index");
  await workspaceService.ensureMigrated();
  return workspaceService;
}

describe.skipIf(!enabled)("workflows on a real mongod", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    server = await MongoMemoryServer.create({
      binary: { version: MONGOD_VERSION },
    });
    const uri = server.getUri("workflows-test");
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
      throw new Error(`Refusing a non-local mongod: ${uri}`);
    }
    await mongoose.connect(uri);
    const cache = global.mongooseCache ?? { conn: null, promise: null };
    cache.conn = mongoose;
    cache.promise = Promise.resolve(mongoose);
    global.mongooseCache = cache;
  }, 600_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no db");
    for (const collection of await db.collections()) {
      await collection.deleteMany({});
    }
    await Promise.all(
      [WorkspacePageModel, WorkspacePageRevisionModel, WorkspacePrefsModel].map(
        (model) => model.init(),
      ),
    );
  });

  describe("templates", () => {
    test("a template round-trips the Mongo repo and instantiates by its caller", async () => {
      const service = await workspace();
      const template = await service.createPage(
        {
          title: "Daily {{date}}",
          template: true,
          blocks: [para("t1", "{{weekday}}: {{input:Focus}}")],
        },
        OWNER,
      );
      const stored = await WorkspacePageModel.findById(template.id).lean();
      expect(stored?.template).toBe(true);
      const page = await service.instantiateTemplate(
        template.id,
        { inputs: { Focus: "Ship" } },
        { actor: "task-run:r1", via: null, agent: true },
        {
          date: "2026-10-30",
          time: "07:00",
          week: "2026-W44",
          weekday: "Friday",
        },
      );
      expect(page.title).toBe("Daily 2026-10-30");
      expect(page.blocks[0]).toMatchObject({ text: runs("Friday: Ship") });
      const plain = await WorkspacePageModel.findById(page.id).lean();
      expect(plain && "template" in plain).toBe(false);
      const revision = await WorkspacePageRevisionModel.findOne({
        pageId: page.id,
      }).lean();
      expect(revision?.actor).toBe("task-run:r1");
      // Unflagging removes the field rather than storing false.
      await service.updateMeta(template.id, { template: false }, OWNER);
      const unflagged = await WorkspacePageModel.findById(template.id).lean();
      expect(unflagged && "template" in unflagged).toBe(false);
    });
  });

  describe("agent sections", () => {
    async function withSection(pinned = false) {
      const service = await workspace();
      const sections = await import("./sections");
      const section: Block = {
        id: "sec",
        type: "section",
        title: "Today",
        prompt: "Summarise the day",
        schedule: { cron: "0 7 * * *", timeZone: "UTC" },
        sources: [],
        pinned,
        children: [],
      };
      const page = await service.createPage(
        { id: "home", title: "Home", blocks: [para("intro", "hi"), section] },
        OWNER,
      );
      await sections.reconcileSections(page, { force: true });
      const task = await AgentTask.findOne({
        "workspaceSection.pageId": "home",
      });
      if (!task) throw new Error("no section task");
      const newRun = async () => {
        const run = await AgentTaskRun.create({
          taskId: task._id,
          taskName: task.name,
          trigger: "manual",
          status: "running",
          scheduledFor: new Date(Date.now() + Math.random() * 1e6),
          toolCalls: [],
        });
        const prepared = await sections.prepareSectionRun(
          task,
          run._id.toString(),
        );
        if ("error" in prepared) throw new Error(prepared.error);
        return { runId: run._id.toString(), prepared };
      };
      return { service, sections, task, newRun };
    }

    const childrenOf = async (
      service: Awaited<ReturnType<typeof workspace>>,
    ) => {
      const page = await service.getPage("home");
      const found = findBlock(page.blocks, "sec")?.block;
      return found && "children" in found ? found.children : [];
    };

    test("the block's config becomes a scheduled, incognito task", async () => {
      const { task } = await withSection();
      expect(task.status).toBe("active");
      expect(task.memoryMode).toBe("incognito");
      expect(task.schedule).toMatchObject({ cron: "0 7 * * *" });
      expect(task.nextRunAt).toBeInstanceOf(Date);
    });

    test("a run writes the children as its task run; an owner edit turns the next into a proposal", async () => {
      const { service, sections, newRun } = await withSection();
      const first = await newRun();
      expect(first.prepared.message).toContain("Summarise the day");
      const written = await sections.applySectionRun(
        first.prepared,
        first.runId,
        "## Morning\n\n- standup",
      );
      expect(written.outcome).toBe("written");
      const children = await childrenOf(service);
      expect(children.map((b) => b.type)).toEqual(["heading", "bullet"]);
      const revision = await WorkspacePageRevisionModel.findOne({
        pageId: "home",
      })
        .sort({ rev: -1 })
        .lean();
      expect(revision?.actor).toBe(`task-run:${first.runId}`);

      // The owner edits inside the section.
      const page = await service.getPage("home");
      const heading = children[0];
      if (!heading) throw new Error("no heading");
      await service.applyOps(
        "home",
        {
          baseRev: page.rev,
          ops: [{ op: "update", id: heading.id, set: { text: runs("Mine") } }],
        },
        OWNER,
      );
      const edited = await sections.sectionState("home", "sec");
      expect(edited.edited).toBe(true);

      const second = await newRun();
      const proposed = await sections.applySectionRun(
        second.prepared,
        second.runId,
        "- replaced",
      );
      expect(proposed.outcome).toBe("proposed");
      const kept = await childrenOf(service);
      expect(kept[0]).toMatchObject({ text: runs("Mine") });
      const state = await sections.sectionState("home", "sec");
      expect(state.proposal?.blocks.map((b) => b.type)).toEqual(["bullet"]);

      // Accepting writes it as the owner and resets the baseline.
      const accepted = await sections.decideSection(
        "home",
        "sec",
        "accept",
        OWNER,
      );
      expect(accepted.proposal).toBeNull();
      expect(accepted.edited).toBe(false);
      expect((await childrenOf(service)).map((b) => b.type)).toEqual([
        "bullet",
      ]);
      const third = await newRun();
      expect(
        (await sections.applySectionRun(third.prepared, third.runId, "- next"))
          .outcome,
      ).toBe("written");
    });

    test("a pinned section only ever proposes; rejecting drops the proposal", async () => {
      const { service, sections, newRun } = await withSection(true);
      const run = await newRun();
      const landed = await sections.applySectionRun(
        run.prepared,
        run.runId,
        "- x",
      );
      expect(landed.outcome).toBe("proposed");
      expect(await childrenOf(service)).toEqual([]);
      const rejected = await sections.decideSection(
        "home",
        "sec",
        "reject",
        OWNER,
      );
      expect(rejected.proposal).toBeNull();
      expect(await childrenOf(service)).toEqual([]);
    });

    test("an edit between reading and writing is refused, never overwritten", async () => {
      const { service } = await withSection();
      const page = await service.getPage("home");
      await service.applyOps(
        "home",
        {
          baseRev: page.rev,
          ops: [
            { op: "insert", block: para("late", "typed"), parentId: "sec" },
          ],
        },
        OWNER,
      );
      let error: unknown = null;
      try {
        await service.replaceChildren(
          "home",
          "sec",
          [para("new", "agent")],
          { actor: "task-run:r", via: null, agent: true },
          [],
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error instanceof WorkspaceError && error.code).toBe("EDITED");
      expect((await childrenOf(service)).map((b) => b.id)).toEqual(["late"]);
    });

    test("deleting the section archives its task", async () => {
      const { service, sections, task } = await withSection();
      const page = await service.getPage("home");
      const after = await service.applyOps(
        "home",
        { baseRev: page.rev, ops: [{ op: "delete", id: "sec" }] },
        OWNER,
      );
      await sections.reconcileSections(after, { force: true });
      const reloaded = await AgentTask.findById(task._id);
      expect(reloaded?.status).toBe("archived");
    });
  });
});
