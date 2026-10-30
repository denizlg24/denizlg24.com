import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlatformBridge } from "@repo/admin/platform";
import type { Block, WorkspacePage } from "@repo/schemas";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";

/*
 * Renders the shared workspace editor — React node views included — into
 * happy-dom with web's routes and a client that never answers: the page's
 * blocks show, node views mount, a locked page is not editable, and mounting
 * and unmounting write nothing back. Not a browser: no layout, so the drag
 * handle and the menus' positions are not exercised.
 */

beforeAll(() => {
  GlobalRegistrator.register();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const runs = (text: string) => [{ type: "text" as const, text }];

const BLOCKS: Block[] = [
  { id: "h", type: "heading", level: 1, text: runs("Week") },
  {
    id: "t",
    type: "toggle",
    text: runs("More"),
    children: [{ id: "in", type: "paragraph", text: runs("inside") }],
  },
  {
    id: "c",
    type: "callout",
    text: runs("Careful"),
    emoji: "⚠️",
    color: "yellow",
    children: [],
  },
  {
    id: "row",
    type: "columns",
    children: [
      {
        id: "c1",
        type: "column",
        width: 0.5,
        children: [{ id: "l", type: "paragraph", text: runs("left") }],
      },
      {
        id: "c2",
        type: "column",
        width: 0.5,
        children: [{ id: "eq", type: "equation", expression: "e^{i\\pi}+1=0" }],
      },
    ],
  },
  {
    id: "m",
    type: "paragraph",
    text: [
      { type: "text", text: "due " },
      { type: "mention", kind: "date", id: "2026-10-29" },
    ],
  },
];

function page(locked: boolean): WorkspacePage {
  return {
    id: "p1",
    title: "P",
    icon: null,
    parentId: null,
    order: 0,
    blocks: BLOCKS,
    fullWidth: false,
    locked,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
}

const platform: PlatformBridge = {
  openExternal: () => {},
  navigate: () => {},
  copyText: async () => {},
  notify: () => {},
  downloadFile: async () => {},
};

test("the workspace editor renders a page's blocks with their node views", async () => {
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
    workspace: { ...seedWorkspace(), pages: { p1: page(false) } },
    loaded: { p1: 1 },
  });
  const client = createAdminClient({
    baseUrl: "/api/admin",
    fetchImpl: () => new Promise<Response>(() => {}),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (editable: boolean) =>
    act(async () => {
      root.render(
        <AdminProvider value={{ client, platform, routes: WEB_ADMIN_ROUTES }}>
          <FlowEditor pageId="p1" editable={editable} />
        </AdminProvider>,
      );
      await settle();
    });

  await render(true);
  const pm = host.querySelector(".ProseMirror");
  expect(pm?.getAttribute("contenteditable")).toBe("true");
  expect(host.querySelector("h1")?.textContent).toBe("Week");
  expect(
    host.querySelector('[data-id="t"] button[aria-label="Collapse"]'),
  ).not.toBeNull();
  expect(host.querySelector('[data-id="c"]')?.textContent).toContain("⚠️");
  expect(host.querySelectorAll(".flow-column")).toHaveLength(2);
  expect(host.querySelector(".katex")).not.toBeNull();
  expect(host.textContent).toContain("Oct 29, 2026");

  await render(false);
  expect(
    host.querySelector(".ProseMirror")?.getAttribute("contenteditable"),
  ).toBe("false");

  await act(async () => {
    root.unmount();
    await settle();
  });
  expect(useWorkspaceStore.getState().workspace.pages.p1?.blocks).toEqual(
    BLOCKS,
  );
});
