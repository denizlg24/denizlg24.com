import { describe, expect, test } from "bun:test";
import type { Block, RichText, WorkflowAction } from "@repo/schemas";
import {
  type ActionDeps,
  type ActionRunContext,
  type CardInput,
  type EventInput,
  runWorkflowActions,
} from "./actions";
import { memoryWorkspaceRepo } from "./memory-repo.test-util";
import { createWorkspaceService, OWNER, type WorkspaceCaller } from "./service";

const runs = (text: string): RichText => (text ? [{ type: "text", text }] : []);
const clock = {
  date: "2026-10-30",
  time: "09:15",
  week: "2026-W44",
  weekday: "Friday",
};

let tick = Date.parse("2026-10-30T08:00:00.000Z");
const now = () => {
  tick += 1000;
  return new Date(tick);
};
let counter = 0;
const newId = () => `n${++counter}`;

async function setup() {
  const memory = memoryWorkspaceRepo(null);
  const workspace = createWorkspaceService(memory.repo, { now, newId });
  await workspace.ensureMigrated();
  const todo: Block = {
    id: "todo1",
    type: "todo",
    text: runs("Water plants"),
    checked: false,
    children: [],
  };
  await workspace.createPage(
    {
      id: "home",
      title: "Home",
      blocks: [
        todo,
        { id: "btn", type: "button", label: "Go", actions: [] },
        { id: "end", type: "paragraph", text: runs("end") },
      ],
    },
    OWNER,
  );
  await workspace.createPage(
    {
      id: "tpl",
      title: "Log {{date}}",
      template: true,
      blocks: [{ id: "t1", type: "paragraph", text: runs("{{input:Who}}") }],
    },
    OWNER,
  );
  const cards: CardInput[] = [];
  const events: EventInput[] = [];
  const deps: ActionDeps = {
    workspace,
    newId,
    createCard: async (input) => {
      cards.push(input);
      return { id: `card${cards.length}` };
    },
    createEvent: async (input) => {
      events.push(input);
      return { id: `event${events.length}` };
    },
  };
  return { ...memory, workspace, deps, cards, events };
}

function context(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
  return {
    host: { pageId: "home", blockId: "btn" },
    caller: OWNER,
    clock,
    timeZone: "UTC",
    interactive: true,
    ...overrides,
  };
}

describe("workflow actions", () => {
  test("each kind writes through its service, by the caller", async () => {
    const { workspace, deps, cards, events, revisions } = await setup();
    const actions: WorkflowAction[] = [
      {
        kind: "create-page",
        templateId: "tpl",
        parentId: "$this",
        inputs: { Who: "{{page.title}} at {{time}}" },
      },
      { kind: "append-blocks", pageId: "$this", markdown: "- {{weekday}} log" },
      { kind: "insert-template", templateId: "tpl", inputs: { Who: "me" } },
      {
        kind: "create-card",
        boardId: "6650f0c2a1b2c3d4e5f60718",
        columnId: "6650f0c2a1b2c3d4e5f60719",
        title: "Review {{week}}",
        dueDate: "{{date}}",
      },
      {
        kind: "create-event",
        title: "Standup",
        date: "{{date}}",
        time: "10:00",
        durationMinutes: 15,
      },
      { kind: "set-todo", pageId: "$this", blockId: "todo1", checked: true },
      { kind: "open", url: "/dashboard?d={{date}}" },
    ];
    const results = await runWorkflowActions(actions, context(), deps);
    expect(results.map((r) => [r.kind, r.ok])).toEqual(
      actions.map((a) => [a.kind, true]),
    );

    const created = results[0]?.pageId ?? "";
    const child = await workspace.getPage(created);
    expect(child.title).toBe("Log 2026-10-30");
    expect(child.parentId).toBe("home");
    expect(child.blocks[0]).toMatchObject({ text: runs("Home at 09:15") });

    const home = await workspace.getPage("home");
    const inserted = results[2]?.blockIds?.[0] ?? "missing";
    expect(home.blocks.map((b) => b.id).slice(0, 3)).toEqual([
      "todo1",
      "btn",
      inserted,
    ]);
    expect(home.blocks.at(-1)).toMatchObject({
      type: "bullet",
      text: runs("Friday log"),
    });
    expect(home.blocks[0]).toMatchObject({ checked: true });
    expect(cards).toEqual([
      {
        boardId: "6650f0c2a1b2c3d4e5f60718",
        columnId: "6650f0c2a1b2c3d4e5f60719",
        title: "Review 2026-W44",
        dueDate: "2026-10-30",
      },
    ]);
    expect(events[0]).toMatchObject({ date: "2026-10-30", time: "10:00" });
    expect(results[6]?.url).toBe("/dashboard?d=2026-10-30");
    expect(revisions.filter((r) => r.pageId === "home" && r.rev > 1)).toSatisfy(
      (list) => list.every((r) => r.actor === "owner"),
    );
  });

  test("a failure is reported and the next action still runs", async () => {
    const { workspace, deps } = await setup();
    const results = await runWorkflowActions(
      [
        { kind: "set-todo", pageId: "$this", blockId: "end", checked: true },
        {
          kind: "create-event",
          title: "x",
          date: "next tuesday",
          durationMinutes: 60,
        },
        { kind: "append-blocks", pageId: "$this", markdown: "after" },
      ],
      context(),
      deps,
    );
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(results[0]?.error).toContain("No to-do end");
    expect(results[1]?.error).toContain("YYYY-MM-DD");
    const home = await workspace.getPage("home");
    expect(home.blocks.at(-1)).toMatchObject({ text: runs("after") });
  });

  test("outside a button: no $this, open is skipped, event fields fill", async () => {
    const { deps, cards } = await setup();
    const trigger: WorkspaceCaller = {
      actor: "owner",
      via: null,
      agent: true,
    };
    const results = await runWorkflowActions(
      [
        { kind: "append-blocks", pageId: "$this", markdown: "x" },
        { kind: "open", url: "https://example.com" },
        {
          kind: "create-card",
          boardId: "6650f0c2a1b2c3d4e5f60718",
          columnId: "6650f0c2a1b2c3d4e5f60719",
          title: "Follow up: {{event.title}}",
        },
      ],
      context({
        host: null,
        caller: trigger,
        interactive: false,
        event: { title: "Ship v2" },
      }),
      deps,
    );
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[1]).toMatchObject({ ok: true, skipped: true });
    expect(cards[0]?.title).toBe("Follow up: Ship v2");
  });

  test("a locked page refuses an agent's write but not the owner's", async () => {
    const { workspace, deps } = await setup();
    await workspace.updateMeta("home", { locked: true }, OWNER);
    const agent: WorkspaceCaller = {
      actor: "conversation:c1",
      via: "mcp:svc",
      agent: true,
    };
    const [refused] = await runWorkflowActions(
      [{ kind: "append-blocks", pageId: "home", markdown: "x" }],
      context({ caller: agent }),
      deps,
    );
    expect(refused?.ok).toBe(false);
    const [allowed] = await runWorkflowActions(
      [{ kind: "append-blocks", pageId: "home", markdown: "x" }],
      context(),
      deps,
    );
    expect(allowed?.ok).toBe(true);
  });
});
