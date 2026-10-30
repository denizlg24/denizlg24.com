import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlatformBridge } from "@repo/admin/platform";
import {
  type Block,
  type RecordSummary,
  VIEW_SOURCES,
  type ViewRow,
  type ViewSourceId,
  viewQueryRequestSchema,
  type WorkspacePage,
} from "@repo/schemas";
import { runViewQuery } from "@repo/utils/workspace-views";
import { format } from "date-fns";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";

/*
 * Record embeds and module views rendered by the shared editor in happy-dom,
 * against a fake API: the records route answers from a table, the views
 * route runs the real engine over fixture rows. Not a browser: nothing is
 * laid out, and clicks, menus and the config popover are not exercised.
 */

beforeAll(() => {
  GlobalRegistrator.register();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const RECORDS: RecordSummary[] = [
  {
    ref: "entity:page:p2",
    kind: "page",
    id: "p2",
    title: "p2",
    icon: null,
    fields: [],
  },
  {
    ref: "entity:note:n1",
    kind: "note",
    id: "n1",
    title: "Reading list",
    subtitle: "books",
    fields: [{ label: "Tags", value: "Books" }],
  },
  {
    ref: "entity:paper:pp1",
    kind: "paper",
    id: "pp1",
    title: "Raft",
    subtitle: "Ongaro, Ousterhout · 2014",
    fields: [
      { label: "Reading", value: "read" },
      { label: "Type", value: "conference" },
    ],
  },
  {
    ref: "entity:kanban-card:c1",
    kind: "kanban-card",
    id: "c1",
    title: "Renew passport",
    subtitle: "Life",
    fields: [{ label: "Due", value: "2026-11-02" }],
  },
];

const month = format(new Date(), "yyyy-MM");
const ROWS: Partial<Record<ViewSourceId, ViewRow[]>> = {
  "kanban-cards": [
    {
      id: "c1",
      ref: "entity:kanban-card:c1",
      values: {
        title: "Renew passport",
        board: "Life",
        column: "Todo",
        done: false,
        due: `${month}-02`,
        labels: ["admin"],
        priority: "high",
        people: [],
      },
    },
    {
      id: "c2",
      ref: "entity:kanban-card:c2",
      values: {
        title: "Book flights",
        board: "Life",
        column: "Done",
        done: true,
        due: `${month}-15T09:00:00.000Z`,
        labels: [],
        priority: "none",
        people: [],
      },
    },
  ],
  "finance-entries": [
    {
      id: "e1",
      ref: null,
      values: {
        description: "Rent",
        amount: { amountMinor: -90_000, currency: "EUR" },
        currency: "EUR",
        date: `${month}-01`,
        category: "Housing",
      },
    },
    {
      id: "e2",
      ref: null,
      values: {
        description: "Føtex",
        amount: { amountMinor: -12_500, currency: "DKK" },
        currency: "DKK",
        date: `${month}-03`,
        category: "Food",
      },
    },
  ],
};

function respond(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function fakeApi(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname.endsWith("/workspace/records")) {
    const refs = (url.searchParams.get("refs") ?? "").split(",");
    return respond({
      records: RECORDS.filter((r) => refs.includes(r.ref)),
      missing: refs.filter((ref) => !RECORDS.some((r) => r.ref === ref)),
    });
  }
  if (url.pathname.endsWith("/workspace/views/query")) {
    const body = viewQueryRequestSchema.parse(JSON.parse(String(init?.body)));
    const view = body.view;
    if (!view) throw new Error("inline views only");
    return respond(
      runViewQuery(VIEW_SOURCES[view.source], ROWS[view.source] ?? [], view, {
        today: body.today ?? `${month}-01`,
      }),
    );
  }
  return new Promise<Response>(() => {});
}

const platform: PlatformBridge = {
  openExternal: () => {},
  navigate: () => {},
  copyText: async () => {},
  notify: () => {},
  downloadFile: async () => {},
};

function page(id: string, blocks: Block[]): WorkspacePage {
  return {
    id,
    title: id,
    icon: null,
    parentId: null,
    order: 0,
    blocks,
    fullWidth: false,
    locked: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));
}

async function mount(pages: WorkspacePage[]) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AdminProvider } = await import("@repo/admin/provider");
  const { createAdminClient } = await import("@repo/admin/client");
  const { useWorkspaceStore } = await import("@repo/admin/workspace/store");
  const { FlowEditor } = await import(
    "@repo/admin/workspace/editor/flow-editor"
  );
  const { seedWorkspace } = await import("@repo/admin/workspace/seed");

  useWorkspaceStore.setState({
    ready: true,
    workspace: {
      ...seedWorkspace(),
      pages: Object.fromEntries(pages.map((p) => [p.id, p])),
    },
    loaded: Object.fromEntries(pages.map((p) => [p.id, 1])),
  });
  const client = createAdminClient({
    baseUrl: "/api/admin",
    fetchImpl: fakeApi,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminProvider value={{ client, platform, routes: WEB_ADMIN_ROUTES }}>
        <FlowEditor pageId={pages[0]?.id ?? ""} editable={false} />
      </AdminProvider>,
    );
    await settle();
  });
  return {
    host,
    unmount: () =>
      act(async () => {
        root.unmount();
        host.remove();
        await settle();
      }),
  };
}

describe("record embeds", () => {
  test("card, full, missing and mention modes", async () => {
    const view = await mount([
      page("p1", [
        { id: "r1", type: "record", ref: "entity:note:n1", mode: "card" },
        { id: "r2", type: "record", ref: "entity:paper:pp1", mode: "full" },
        { id: "r3", type: "record", ref: "entity:person:gone", mode: "card" },
        { id: "r4", type: "record", ref: "entity:page:p2", mode: "full" },
        {
          id: "m",
          type: "paragraph",
          text: [
            { type: "text", text: "see " },
            { type: "mention", kind: "kanban-card", id: "c1", label: "old" },
          ],
        },
      ]),
      page("p2", [
        {
          id: "inner",
          type: "paragraph",
          text: [{ type: "text", text: "embedded page body" }],
        },
      ]),
    ]);
    const { host } = view;

    const card = host.querySelector(
      '[data-id="r1"] [data-record="entity:note:n1"]',
    );
    expect(card?.textContent).toContain("Reading list");
    expect(card?.textContent).toContain("Books");
    expect(card?.getAttribute("href")).toBe("/admin/dashboard/notes");

    // A paper has no module component that stands alone: every field, as properties.
    const sheet = host.querySelector(
      '[data-id="r2"] [data-record="entity:paper:pp1"]',
    );
    expect(sheet?.textContent).toContain("Raft");
    expect(sheet?.textContent).toContain("conference");
    expect(sheet?.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/dashboard/papers/pp1/read",
    );

    expect(
      host.querySelector('[data-id="r3"] [data-record-missing]'),
    ).not.toBeNull();

    const nested = host.querySelector(
      '[data-id="r4"] [data-record-full="page:p2"]',
    );
    expect(nested?.textContent).toContain("embedded page body");

    const mention = host.querySelector(
      '[data-mention="entity:kanban-card:c1"]',
    );
    expect(mention?.textContent).toBe("@Renew passport");
    // Web has no kanban surface, so the mention is text, not a link.
    expect(mention?.tagName).toBe("SPAN");

    await view.unmount();
  });
});

describe("module views", () => {
  const viewBlock = (
    id: string,
    source: ViewSourceId,
    layout: "table" | "list" | "board" | "calendar" | "gallery",
    extra: Partial<Extract<Block, { type: "view" }>> = {},
  ): Block => ({
    id,
    type: "view",
    source,
    layout,
    filters: [],
    sort: [],
    limit: 25,
    ...extra,
  });

  test("one renderer per layout", async () => {
    const view = await mount([
      page("v", [
        viewBlock("t", "finance-entries", "table", { group: "category" }),
        viewBlock("l", "kanban-cards", "list"),
        viewBlock("b", "kanban-cards", "board"),
        viewBlock("c", "kanban-cards", "calendar"),
        viewBlock("g", "kanban-cards", "gallery"),
      ]),
    ]);
    const { host } = view;
    const at = (id: string) => host.querySelector(`[data-id="${id}"]`);

    // Table: money in each row's own currency, groups and the footer per currency.
    const table = at("t")?.querySelector('[data-layout="table"]');
    expect(table?.querySelectorAll("[data-row]")).toHaveLength(2);
    expect(table?.querySelector('[data-row="e2"]')?.textContent).toContain(
      "DKK",
    );
    expect(
      [...(table?.querySelectorAll("[data-group]") ?? [])].map((g) =>
        g.getAttribute("data-group"),
      ),
    ).toEqual(["Food", "Housing"]);
    const footer = table?.querySelector('tfoot [data-totals="amount"]');
    expect(footer?.children).toHaveLength(2);
    expect(footer?.textContent).toContain("DKK");
    expect(footer?.textContent).toContain("€");
    expect(at("t")?.querySelector("[data-view-total]")?.textContent).toBe("2");

    const list = at("l")?.querySelector('[data-layout="list"]');
    expect(list?.querySelectorAll("[data-row]")).toHaveLength(2);

    // Board: the source's default group (column) when the view names none.
    const board = at("b")?.querySelector('[data-layout="board"]');
    expect(
      [...(board?.querySelectorAll("[data-group]") ?? [])].map((g) =>
        g.getAttribute("data-group"),
      ),
    ).toEqual(["Done", "Todo"]);

    // Calendar: rows on their day of the current month.
    const calendar = at("c")?.querySelector('[data-layout="calendar"]');
    expect(
      calendar?.querySelector(`[data-day="${month}-02"] [data-row="c1"]`),
    ).not.toBeNull();

    // Gallery: rows with an entity ref show the record card.
    const gallery = at("g")?.querySelector('[data-layout="gallery"]');
    expect(
      gallery?.querySelector(
        '[data-tile="c1"] [data-record="entity:kanban-card:c1"]',
      ),
    ).not.toBeNull();

    await view.unmount();
  });
});
