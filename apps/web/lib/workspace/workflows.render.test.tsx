import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlatformBridge } from "@repo/admin/platform";
import type { Block, WorkspacePage } from "@repo/schemas";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";

/*
 * Workflow blocks and surfaces rendered by the shared admin code in
 * happy-dom against a fake API. Not a browser: nothing is laid out, and only
 * plain clicks are exercised — no menus, popovers or dialogs' internals.
 */

beforeAll(() => {
  GlobalRegistrator.register();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function respond(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (call: Call, url: URL) => object | null;

function fakeApi(calls: Call[], handle: Handler) {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/admin\//, ""),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const body = handle(call, url);
    return body ? respond(body) : new Promise<Response>(() => {});
  };
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

async function mount(
  pages: WorkspacePage[],
  handle: Handler,
  render?: () => Promise<React.ReactNode>,
) {
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
  const calls: Call[] = [];
  const client = createAdminClient({
    baseUrl: "/api/admin",
    fetchImpl: fakeApi(calls, handle),
  });
  const content = render ? (
    await render()
  ) : (
    <FlowEditor pageId={pages[0]?.id ?? ""} editable={false} />
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminProvider value={{ client, platform, routes: WEB_ADMIN_ROUTES }}>
        {content}
      </AdminProvider>,
    );
    await settle();
  });
  return {
    host,
    calls,
    act,
    unmount: () =>
      act(async () => {
        root.unmount();
        host.remove();
        await settle();
      }),
  };
}

function buttonNamed(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

describe("button block", () => {
  test("an actions button presses through the run route; an agent button shows its last run", async () => {
    const view = await mount(
      [
        page("p1", [
          {
            id: "b1",
            type: "button",
            label: "Log",
            mode: "actions",
            actions: [
              { kind: "append-blocks", pageId: "$this", markdown: "x" },
            ],
            agentPrompt: "",
          },
          {
            id: "b2",
            type: "button",
            label: "Summarise",
            mode: "agent",
            actions: [],
            agentPrompt: "Summarise this page",
          },
          {
            id: "b3",
            type: "button",
            label: "",
            mode: "actions",
            actions: [],
            agentPrompt: "",
          },
        ]),
      ],
      (call, url) => {
        if (call.path === "workspace/buttons/run" && call.method === "GET") {
          return url.searchParams.get("blockId") === "b2"
            ? {
                run: {
                  runId: "r1",
                  conversationId: "c1",
                  status: "completed",
                  startedAt: "2026-10-30T08:00:00.000Z",
                  completedAt: "2026-10-30T08:01:00.000Z",
                },
              }
            : { run: null };
        }
        if (call.path === "workspace/buttons/run" && call.method === "POST") {
          return {
            mode: "actions",
            results: [
              { index: 0, kind: "append-blocks", ok: true, pageId: "p1" },
            ],
          };
        }
        return null;
      },
    );
    const { host, calls, act } = view;
    const log = buttonNamed(host, "Log");
    expect(log.disabled).toBe(false);
    expect(host.textContent).toContain("completed");
    // A button with nothing to do is shown but cannot be pressed.
    expect(buttonNamed(host, "Button").disabled).toBe(true);

    await act(async () => {
      log.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const press = calls.find(
      (c) => c.method === "POST" && c.path === "workspace/buttons/run",
    );
    expect(press?.body).toEqual({ pageId: "p1", blockId: "b1" });
    await view.unmount();
  });
});
