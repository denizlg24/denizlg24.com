import { describe, expect, it } from "bun:test";

import {
  type DetectDirEntry,
  detectBuildConfig,
  detectWorkspaces,
  type RepoInspector,
} from "./detect";

/**
 * Keys are repository-relative paths; a directory is any key whose value is an
 * array. The root directory is the empty string, matching what the Contents
 * API and `detectBuildConfig` both use.
 */
function repo(tree: Record<string, string | string[]>): RepoInspector {
  const dirEntries = (path: string): DetectDirEntry[] | null => {
    const value = tree[path];
    if (!Array.isArray(value)) return null;
    return value.map((name) => ({
      name: name.replace(/\/$/, ""),
      type: name.endsWith("/") ? "dir" : "file",
    }));
  };
  return {
    listDirectory: async (path) => dirEntries(path.replace(/^\/+|\/+$/g, "")),
    readFile: async (path) => {
      const value = tree[path.replace(/^\/+|\/+$/g, "")];
      return typeof value === "string" ? value : null;
    },
  };
}

const pkg = (body: Record<string, unknown>) => JSON.stringify(body);

describe("detectBuildConfig", () => {
  it("prefers a Dockerfile over the framework it would otherwise detect", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["Dockerfile", "package.json", "bun.lock"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(detected.framework).toBe("dockerfile");
    expect(detected.builder).toBe("dockerfile");
    expect(detected.dockerfilePath).toBe("Dockerfile");
    // The agent refuses these on the dockerfile path, so detection must not
    // hand back a config that would be rejected at build time.
    expect(detected.installCommand).toBeNull();
    expect(detected.buildCommand).toBeNull();
  });

  it("detects Next.js and prefers the declared scripts", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "pnpm-lock.yaml"],
        "package.json": pkg({
          scripts: { build: "next build --turbopack", start: "next start" },
          dependencies: { next: "15.0.0" },
        }),
      }),
    );

    expect(detected.framework).toBe("nextjs");
    expect(detected.builder).toBe("nixpacks");
    expect(detected.installCommand).toBe("pnpm install --frozen-lockfile");
    expect(detected.buildCommand).toBe("pnpm run build");
    expect(detected.startCommand).toBe("pnpm run start");
  });

  it("falls back to an inferred command when no script is declared", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(detected.buildCommand).toBe("bunx --bun next build");
    expect(detected.startCommand).toBe("bunx --bun next start");
  });

  it("takes the lockfile from the repository root when the workspace has none", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        apps: ["web/"],
        "apps/web": ["package.json"],
        "apps/web/package.json": pkg({
          scripts: { build: "vite build" },
          dependencies: { vite: "5.0.0" },
        }),
      }),
      "apps/web",
    );

    expect(detected.framework).toBe("vite");
    expect(detected.installCommand).toBe("bun install");
    expect(detected.buildCommand).toBe("bun run build");
  });

  it("serves a Vite SPA from its build output", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "package-lock.json"],
        "package.json": pkg({ dependencies: { vite: "5.0.0" } }),
      }),
    );

    expect(detected.startCommand).toBe(
      "npx --yes serve -s dist -l ${PORT:-3000}",
    );
  });

  it("splits Astro on whether it has a node adapter", async () => {
    const withAdapter = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          dependencies: { astro: "4.0.0", "@astrojs/node": "8.0.0" },
        }),
      }),
    );
    const staticOnly = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({ dependencies: { astro: "4.0.0" } }),
      }),
    );

    expect(withAdapter.startCommand).toBe("node ./dist/server/entry.mjs");
    expect(staticOnly.startCommand).toContain("serve -s dist");
  });

  it("ranks SvelteKit above the Vite it depends on", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          dependencies: { "@sveltejs/kit": "2.0.0", vite: "5.0.0" },
        }),
      }),
    );

    expect(detected.framework).toBe("sveltekit");
  });

  it("leaves the Django start command unset rather than guessing the wsgi module", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["manage.py", "requirements.txt"],
        "requirements.txt": "Django==5.0\ngunicorn==22.0",
      }),
    );

    expect(detected.framework).toBe("django");
    expect(detected.installCommand).toBe("pip install -r requirements.txt");
    expect(detected.startCommand).toBeNull();
  });

  it("detects FastAPI from the requirements file", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["requirements.txt", "main.py"],
        "requirements.txt": "fastapi\nuvicorn[standard]",
      }),
    );

    expect(detected.framework).toBe("fastapi");
    expect(detected.startCommand).toContain("uvicorn main:app");
  });

  it("never leaves a Node project's version to nixpacks", async () => {
    // The failure this exists to prevent: nixpacks resolves ">=18" to exactly
    // 18, which nixpkgs removed at EOL, and the build dies in a nix trace.
    const range = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          engines: { node: ">=18" },
          dependencies: { next: "15.0.0" },
        }),
      }),
    );
    const undeclared = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(range.nodeVersion).toBe("20");
    expect(undeclared.nodeVersion).toBe("22");
  });

  it("honours an exact pin that is still offered", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          engines: { node: "24.1.0" },
          dependencies: { next: "15.0.0" },
        }),
      }),
    );

    expect(detected.nodeVersion).toBe("24");
  });

  it("rounds a pin newer than anything offered down to the newest", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          engines: { node: "^26" },
          dependencies: { next: "15.0.0" },
        }),
      }),
    );

    expect(detected.nodeVersion).toBe("24");
  });

  it("leaves the version unset for stacks that have no Node", async () => {
    const python = await detectBuildConfig(
      repo({
        "": ["requirements.txt"],
        "requirements.txt": "fastapi",
      }),
    );
    const dockerfile = await detectBuildConfig(
      repo({ "": ["Dockerfile", "package.json"] }),
    );

    expect(python.nodeVersion).toBeNull();
    // The agent refuses a Node version alongside a Dockerfile, which states
    // its own base image.
    expect(dockerfile.nodeVersion).toBeNull();
  });

  it("reports unknown for a directory it cannot read", async () => {
    const detected = await detectBuildConfig(repo({}), "apps/missing");

    expect(detected.framework).toBe("unknown");
    expect(detected.builder).toBe("auto");
  });

  it("falls back to plain Node when nothing in the table matches", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json"],
        "package.json": pkg({
          scripts: { start: "node server.js" },
          dependencies: { hono: "4.0.0" },
        }),
      }),
    );

    expect(detected.framework).toBe("node");
    expect(detected.startCommand).toBe("npm run start");
    expect(detected.buildCommand).toBeNull();
  });
});

describe("detectWorkspaces", () => {
  it("expands a one-level glob from package.json workspaces", async () => {
    const found = await detectWorkspaces(
      repo({
        "": ["package.json", "apps/", "packages/"],
        "package.json": pkg({ workspaces: ["apps/*", "packages/*"] }),
        apps: ["api/", "web/"],
        packages: ["schemas/"],
      }),
    );

    expect(found.map((entry) => entry.path)).toEqual([
      "apps/api",
      "apps/web",
      "packages/schemas",
    ]);
  });

  it("reads the pnpm workspace file and dedupes against package.json", async () => {
    const found = await detectWorkspaces(
      repo({
        "": ["package.json", "pnpm-workspace.yaml", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - services/worker\n',
        apps: ["web/"],
      }),
    );

    expect(found.map((entry) => entry.path)).toEqual([
      "apps/web",
      "services/worker",
    ]);
  });

  it("returns nothing for a repository that declares no workspaces", async () => {
    const found = await detectWorkspaces(
      repo({
        "": ["package.json"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(found).toEqual([]);
  });
});
