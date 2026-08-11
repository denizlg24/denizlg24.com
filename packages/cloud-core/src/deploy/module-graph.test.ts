import { describe, expect, it } from "bun:test";

import type { RepoInspector } from "./detect";
import {
  collectGraphWorkspaces,
  entryCandidates,
  extractSpecifiers,
  graphReaches,
  type ModuleGraph,
  type ModuleGraphFs,
  readGraphWorkspace,
  resolveModuleGraph,
} from "./module-graph";

function pkg(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

/**
 * The shape this exists for: one schema package entered through three subpath
 * exports, with no module shared between them.
 */
const REPO: Record<string, string> = {
  "package.json": pkg({ workspaces: ["apps/*", "packages/*"] }),

  "apps/api/package.json": pkg({
    name: "api",
    dependencies: { "@repo/schemas": "workspace:*" },
  }),
  "apps/api/tsconfig.json": pkg({
    compilerOptions: { paths: { "@/*": ["./src/*"] } },
  }),
  "apps/api/src/index.ts": `
    import { deploySchema } from "@repo/schemas/cloud";
    import { boot } from "@/boot";
  `,
  "apps/api/src/boot.ts": `export const boot = () => {};`,

  "apps/web/package.json": pkg({
    name: "web",
    dependencies: { "@repo/schemas": "workspace:*" },
  }),
  "apps/web/app/page.tsx": `import { whiteboardSchema } from "@repo/schemas";`,

  "packages/schemas/package.json": pkg({
    name: "@repo/schemas",
    exports: {
      ".": "./src/index.ts",
      "./cloud": "./src/cloud/index.ts",
    },
  }),
  "packages/schemas/src/index.ts": `
    export * from "./whiteboard";
    export * from "./shared";
  `,
  "packages/schemas/src/whiteboard.ts": `import { z } from "zod";`,
  "packages/schemas/src/shared.ts": `export const shared = 1;`,
  "packages/schemas/src/whiteboard.test.ts": `import "./whiteboard";`,
  "packages/schemas/src/cloud/index.ts": `export * from "./deploy";`,
  "packages/schemas/src/cloud/deploy.ts": `import { shared } from "../shared";`,
};

function fsFor(files: Record<string, string>): ModuleGraphFs & RepoInspector {
  return {
    readFile: async (path) => files[path] ?? null,
    listFiles: async (directory) => {
      const found = Object.keys(files).filter(
        (path) => path === directory || path.startsWith(`${directory}/`),
      );
      return found.length > 0 ? found : null;
    },
    listDirectory: async (path) => {
      const names = new Set<string>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(`${path}/`)) continue;
        const rest = file.slice(path.length + 1);
        const [head] = rest.split("/");
        if (head) names.add(head);
      }
      return [...names].map((name) => ({
        name,
        type: rest(files, path, name) ? ("dir" as const) : ("file" as const),
      }));
    },
  };
}

function rest(
  files: Record<string, string>,
  path: string,
  name: string,
): boolean {
  return Object.keys(files).some((file) => file.startsWith(`${path}/${name}/`));
}

async function graphFor(
  rootDirectory: string,
  files: Record<string, string> = REPO,
): Promise<ModuleGraph> {
  const fs = fsFor(files);
  return resolveModuleGraph({
    fs,
    workspaces: await collectGraphWorkspaces(fs),
    rootDirectory,
    sha: "abc1234",
  });
}

describe("resolveModuleGraph", () => {
  it("follows only the subpath export the target imports", async () => {
    const graph = await graphFor("apps/api");

    expect(graph.complete).toBe(true);
    expect(graph.opaqueWorkspaces).toEqual([]);
    expect(graph.files).toEqual([
      "packages/schemas/src/cloud/deploy.ts",
      "packages/schemas/src/cloud/index.ts",
      "packages/schemas/src/shared.ts",
    ]);
    expect(graph.files).not.toContain("packages/schemas/src/whiteboard.ts");
    expect(graph.files).not.toContain("packages/schemas/src/index.ts");
  });

  it("follows the root export for a target that imports the barrel", async () => {
    const graph = await graphFor("apps/web");

    expect(graph.files).toContain("packages/schemas/src/whiteboard.ts");
    expect(graph.files).toContain("packages/schemas/src/index.ts");
  });

  it("never reports a test file no entry point imports", async () => {
    for (const root of ["apps/api", "apps/web"]) {
      const graph = await graphFor(root);
      expect(graph.files).not.toContain(
        "packages/schemas/src/whiteboard.test.ts",
      );
    }
  });

  it("excludes the target's own files, which are watched regardless", async () => {
    const graph = await graphFor("apps/api");
    expect(graph.files.some((file) => file.startsWith("apps/api/"))).toBe(
      false,
    );
  });

  it("resolves tsconfig path aliases rather than calling them opaque", async () => {
    const graph = await graphFor("apps/api");
    expect(graph.opaqueWorkspaces).not.toContain("apps/api");
  });

  it("marks a workspace opaque when a computed import leaves the graph open", async () => {
    const graph = await graphFor("apps/api", {
      ...REPO,
      "packages/schemas/src/cloud/deploy.ts": `
        const name = "deploy";
        await import(\`./\${name}\`);
      `,
    });
    expect(graph.opaqueWorkspaces).toEqual(["packages/schemas"]);
    expect(graph.files).toEqual([]);
  });

  it("marks a workspace opaque when its export points outside the checkout", async () => {
    const graph = await graphFor("apps/api", {
      ...REPO,
      "packages/schemas/package.json": pkg({
        name: "@repo/schemas",
        exports: { "./cloud": "./dist/cloud/index.js" },
      }),
    });
    expect(graph.opaqueWorkspaces).toEqual(["packages/schemas"]);
  });

  it("reports itself incomplete when the target directory is absent", async () => {
    const graph = await graphFor("apps/missing");
    expect(graph.complete).toBe(false);
  });

  it("reports itself incomplete when the budget runs out", async () => {
    const fs = fsFor(REPO);
    const graph = await resolveModuleGraph({
      fs,
      workspaces: await collectGraphWorkspaces(fs),
      rootDirectory: "apps/api",
      sha: "abc1234",
      fileBudget: 2,
    });
    expect(graph.complete).toBe(false);
  });
});

describe("graphReaches", () => {
  const graph: ModuleGraph = {
    sha: "abc1234",
    rootDirectory: "apps/api",
    files: ["packages/schemas/src/cloud/index.ts"],
    opaqueWorkspaces: ["packages/ui"],
    complete: true,
  };

  it("reaches an imported file", () => {
    expect(graphReaches(graph, "packages/schemas/src/cloud/index.ts")).toBe(
      true,
    );
  });

  it("does not reach a sibling source file", () => {
    expect(graphReaches(graph, "packages/schemas/src/whiteboard.ts")).toBe(
      false,
    );
  });

  it("reaches everything in an opaque workspace", () => {
    expect(graphReaches(graph, "packages/ui/src/anything.tsx")).toBe(true);
  });

  it("reaches a manifest or config it never opened", () => {
    expect(graphReaches(graph, "packages/schemas/package.json")).toBe(true);
    expect(graphReaches(graph, "packages/schemas/tsconfig.json")).toBe(true);
  });

  it("reaches an asset it cannot prove is unused", () => {
    expect(graphReaches(graph, "packages/schemas/src/logo.svg")).toBe(true);
  });
});

describe("extractSpecifiers", () => {
  it("finds every static form", () => {
    const { specifiers, dynamic } = extractSpecifiers(`
      import a from "./a";
      import type { B } from "./b";
      export * from "./c";
      export { d } from "./d";
      import "./e";
      const f = await import("./f");
      const g = require("./g");
    `);
    expect(specifiers.sort()).toEqual([
      "./a",
      "./b",
      "./c",
      "./d",
      "./e",
      "./f",
      "./g",
    ]);
    expect(dynamic).toBe(false);
  });

  it("flags a computed import", () => {
    expect(extractSpecifiers(`await import(name);`).dynamic).toBe(true);
    expect(extractSpecifiers("await import(`./${name}`);").dynamic).toBe(true);
  });

  it("does not flag a multi-line literal import", () => {
    expect(extractSpecifiers(`await import(\n  "./a"\n);`).dynamic).toBe(false);
  });
});

describe("entryCandidates", () => {
  const workspace = readGraphWorkspace(
    "packages/schemas",
    REPO["packages/schemas/package.json"] ?? null,
  );

  it("resolves a subpath export", () => {
    expect(entryCandidates(workspace!, "./cloud")).toEqual([
      "packages/schemas/src/cloud/index.ts",
    ]);
  });

  it("resolves the root export", () => {
    expect(entryCandidates(workspace!, ".")).toEqual([
      "packages/schemas/src/index.ts",
    ]);
  });

  it("refuses a subpath the exports map does not declare", () => {
    expect(entryCandidates(workspace!, "./whiteboard")).toEqual([]);
  });

  it("allows deep imports into a package with no exports map", () => {
    const legacy = readGraphWorkspace(
      "packages/legacy",
      pkg({ name: "@repo/legacy" }),
    );
    expect(entryCandidates(legacy!, "./src/thing")).toEqual([
      "packages/legacy/src/thing",
    ]);
  });

  it("expands a wildcard export", () => {
    const wildcard = readGraphWorkspace(
      "packages/w",
      pkg({ name: "@repo/w", exports: { "./*": "./src/*.ts" } }),
    );
    expect(entryCandidates(wildcard!, "./thing")).toEqual([
      "packages/w/src/thing.ts",
    ]);
  });
});
