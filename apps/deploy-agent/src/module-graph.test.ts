import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createCheckoutFs, resolveCheckoutModuleGraph } from "./module-graph";

async function checkout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forge-graph-"));
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
  }
  return root;
}

const REPO: Record<string, string> = {
  "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
  "apps/web/package.json": JSON.stringify({
    name: "web",
    dependencies: { "@repo/schemas": "workspace:*" },
  }),
  "apps/web/app/page.tsx": `import { cloud } from "@repo/schemas/cloud";`,
  "packages/schemas/package.json": JSON.stringify({
    name: "@repo/schemas",
    exports: { ".": "./src/index.ts", "./cloud": "./src/cloud.ts" },
  }),
  "packages/schemas/src/index.ts": `export * from "./whiteboard";`,
  "packages/schemas/src/whiteboard.ts": `export const whiteboard = 1;`,
  "packages/schemas/src/cloud.ts": `export const cloud = 1;`,
};

describe("createCheckoutFs", () => {
  it("reports repository-relative paths", async () => {
    const root = await checkout(REPO);
    try {
      const fs = createCheckoutFs(root);
      const files = await fs.listFiles("packages/schemas");
      expect(files?.sort()).toEqual([
        "packages/schemas/package.json",
        "packages/schemas/src/cloud.ts",
        "packages/schemas/src/index.ts",
        "packages/schemas/src/whiteboard.ts",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to read outside the checkout", async () => {
    const root = await checkout(REPO);
    try {
      const fs = createCheckoutFs(root);
      expect(await fs.readFile("../../../etc/hosts")).toBeNull();
      expect(await fs.listFiles("..")).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes build output rather than walking into it", async () => {
    const root = await checkout({
      ...REPO,
      "apps/web/node_modules/junk/index.js": "module.exports = 1;",
      "apps/web/.next/server/page.js": "1;",
    });
    try {
      const files = (await createCheckoutFs(root).listFiles("apps/web")) ?? [];
      expect(files.some((file) => file.includes("node_modules"))).toBe(false);
      expect(files.some((file) => file.includes(".next"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null for a directory that is not there", async () => {
    const root = await checkout(REPO);
    try {
      expect(await createCheckoutFs(root).listFiles("apps/missing")).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveCheckoutModuleGraph", () => {
  it("resolves only the subpath the target imports", async () => {
    const root = await checkout(REPO);
    try {
      const graph = await resolveCheckoutModuleGraph({
        source: root,
        rootDirectory: "apps/web",
        sha: "abc1234",
      });
      expect(graph?.complete).toBe(true);
      expect(graph?.files).toEqual(["packages/schemas/src/cloud.ts"]);
      expect(graph?.resolvedAt).toBeString();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves nothing for a repository-root target", async () => {
    const root = await checkout(REPO);
    try {
      expect(
        await resolveCheckoutModuleGraph({
          source: root,
          rootDirectory: "",
          sha: "abc1234",
        }),
      ).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports itself incomplete rather than throwing on a missing checkout", async () => {
    const graph = await resolveCheckoutModuleGraph({
      source: join(tmpdir(), "forge-graph-does-not-exist"),
      rootDirectory: "apps/web",
      sha: "abc1234",
    });
    expect(graph?.complete).toBe(false);
  });
});
