import { describe, expect, test } from "bun:test";
import type { Block, RichText } from "@repo/schemas";
import { memoryWorkspaceRepo } from "./memory-repo.test-util";
import {
  createWorkspaceService,
  OWNER,
  type WorkspaceCaller,
  WorkspaceError,
} from "./service";

const AGENT: WorkspaceCaller = {
  actor: "conversation:c1",
  via: "mcp:svc",
  agent: true,
};
const clock = {
  date: "2026-10-30",
  time: "08:00",
  week: "2026-W44",
  weekday: "Friday",
};

const runs = (text: string): RichText => (text ? [{ type: "text", text }] : []);
const para = (id: string, value = id): Block => ({
  id,
  type: "paragraph",
  text: runs(value),
});
const runsOf = (block: Block | undefined) =>
  block && "text" in block ? block.text : null;

let tick = Date.parse("2026-10-30T07:00:00.000Z");
const now = () => {
  tick += 1000;
  return new Date(tick);
};
let counter = 0;
const newId = () => `id${++counter}`;

async function setup() {
  const memory = memoryWorkspaceRepo(null);
  const service = createWorkspaceService(memory.repo, { now, newId });
  await service.ensureMigrated();
  await service.createPage(
    { id: "home", title: "Home", blocks: [para("a"), para("b")] },
    OWNER,
  );
  const template = await service.createPage(
    {
      title: "Daily {{date}}",
      template: true,
      blocks: [
        {
          id: "t-h",
          type: "heading",
          level: 2,
          text: runs("{{weekday}} — {{input:Focus}}"),
        },
        {
          id: "t-tg",
          type: "toggle",
          text: runs("More"),
          children: [para("t-p", "{{page.title}}")],
        },
      ],
    },
    OWNER,
  );
  return { ...memory, service, template };
}

async function rejection(promise: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceError) return error;
    throw error;
  }
  throw new Error("expected a WorkspaceError");
}

describe("templates", () => {
  test("lists templates with their inputs and keeps them out of 3.0.0", async () => {
    const { service, template } = await setup();
    expect(await service.listTemplates()).toMatchObject([
      { id: template.id, title: "Daily {{date}}", inputs: ["Focus"] },
    ]);
    const v1 = await service.compatGet();
    expect(v1.pages[template.id]).toBeUndefined();
    expect(v1.pages.home).toBeDefined();
  });

  test("instantiates a page with fresh ids and filled variables, by the caller", async () => {
    const { service, template, revisions } = await setup();
    const page = await service.instantiateTemplate(
      template.id,
      { parentId: "home", inputs: { Focus: "Ship" } },
      AGENT,
      clock,
    );
    expect(page.title).toBe("Daily 2026-10-30");
    expect(page.template).toBeUndefined();
    expect(page.parentId).toBe("home");
    expect(runsOf(page.blocks[0])).toEqual(runs("Friday — Ship"));
    const toggled = page.blocks[1];
    expect(
      toggled && "children" in toggled ? runsOf(toggled.children[0]) : null,
    ).toEqual(runs("Daily 2026-10-30"));
    expect(page.blocks.map((b) => b.id)).not.toContain("t-h");
    expect(revisions.find((r) => r.pageId === page.id)).toMatchObject({
      actor: AGENT.actor,
      kind: "create",
    });
  });

  test("inserts a template into a page after a block, as one revision", async () => {
    const { service, template } = await setup();
    const before = await service.getPage("home");
    const after = await service.insertTemplate(
      template.id,
      { pageId: "home", after: "a", inputs: {} },
      OWNER,
      clock,
    );
    expect(after.rev).toBe(before.rev + 1);
    expect(after.blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "heading",
      "toggle",
      "paragraph",
    ]);
    expect(runsOf(after.blocks[1])).toEqual(runs("Friday — "));
    const toggled = after.blocks[2];
    expect(
      toggled && "children" in toggled ? runsOf(toggled.children[0]) : null,
    ).toEqual(runs("Home"));
  });

  test("refuses a page that is not a template", async () => {
    const { service } = await setup();
    const error = await rejection(
      service.instantiateTemplate("home", {}, OWNER, clock),
    );
    expect(error.code).toBe("NOT_TEMPLATE");
    expect(error.status).toBe(404);
  });

  test("saves blocks as a new template; the flag toggles through meta", async () => {
    const { service } = await setup();
    const saved = await service.templateFromBlocks(
      { pageId: "home", blockIds: ["b"], title: "Snippet" },
      OWNER,
    );
    expect(saved.template).toBe(true);
    expect(saved.blocks).toHaveLength(1);
    expect(saved.blocks[0]?.id).not.toBe("b");
    expect(await service.listTemplates()).toHaveLength(2);
    const plain = await service.updateMeta(
      saved.id,
      { template: false },
      OWNER,
    );
    expect(plain.template).toBeUndefined();
    expect(await service.listTemplates()).toHaveLength(1);
  });
});
