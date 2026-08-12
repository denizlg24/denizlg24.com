import { describe, expect, it } from "bun:test";

import {
  type DetectDirEntry,
  detectBuildConfig,
  detectWorkspaceContext,
  detectWorkspaces,
  type RepoInspector,
  resolveBuildConfig,
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
    // Install is never wrapped: the lockfile and the linked workspace packages
    // are both at the root, which is where the build context now starts.
    expect(detected.installCommand).toBe("bun install");
    expect(detected.buildCommand).toBe("cd apps/web && bun run build");
  });

  it("hands the build to turbo when the repository has it", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock", "turbo.json", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        "turbo.json": JSON.stringify({ tasks: { build: {} } }),
        apps: ["web/"],
        "apps/web": ["package.json"],
        "apps/web/package.json": pkg({
          name: "web",
          scripts: { build: "next build", start: "next start" },
          dependencies: { next: "15.0.0" },
        }),
      }),
      "apps/web",
    );

    expect(detected.framework).toBe("nextjs");
    expect(detected.installCommand).toBe("bun install");
    // Turbo builds the workspace's dependencies first, which running the app's
    // own build script from its directory does not.
    expect(detected.buildCommand).toBe(
      "bunx --bun turbo run build --filter=web",
    );
    // Start is still the app's own, and still needs the working directory.
    expect(detected.startCommand).toBe("cd apps/web && bun run start");
  });

  it("does not filter turbo to a package with no build task", async () => {
    // `turbo run build --filter=x` where x declares no build script exits 0
    // having built nothing, which is a green deploy serving a stale image.
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock", "turbo.json", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        "turbo.json": JSON.stringify({ tasks: { build: {} } }),
        apps: ["api/"],
        "apps/api": ["package.json"],
        "apps/api/package.json": pkg({
          name: "api",
          scripts: { start: "bun run src/index.ts" },
          dependencies: { hono: "4.0.0" },
        }),
      }),
      "apps/api",
    );

    expect(detected.framework).toBe("hono");
    expect(detected.buildCommand).toBeNull();
    expect(detected.startCommand).toBe("cd apps/api && bun run start");
  });

  it("points the Dockerfile path at the repository root", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        apps: ["api/"],
        "apps/api": ["Dockerfile", "package.json"],
      }),
      "apps/api",
    );

    // The build context is the repository root, and `--file` is resolved
    // against it — a path relative to the app directory would not be found.
    expect(detected.dockerfilePath).toBe("apps/api/Dockerfile");
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

    expect(range.runtimeVersion).toBe("20");
    expect(undeclared.runtimeVersion).toBe("22");
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

    expect(detected.runtimeVersion).toBe("24");
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

    expect(detected.runtimeVersion).toBe("24");
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

    expect(python.runtimeVersion).toBeNull();
    // The agent refuses a Node version alongside a Dockerfile, which states
    // its own base image.
    expect(dockerfile.runtimeVersion).toBeNull();
  });

  it("reads the runtime off the lockfile and pins Bun to a real version", async () => {
    const bun = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );
    const node = await detectBuildConfig(
      repo({
        "": ["package.json", "package-lock.json"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(bun.runtime).toBe("bun");
    // Not null: unset hands the choice back to nixpacks, which has no Bun
    // version knob and resolves 1.3.0 from a hardcoded nixpkgs commit.
    expect(bun.runtimeVersion).toBe("1.3.14");
    expect(node.runtime).toBe("node");
    expect(node.runtimeVersion).toBe("22");
  });

  it("ignores engines.node when the runtime is Bun", async () => {
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock"],
        "package.json": pkg({
          engines: { node: "20" },
          dependencies: { next: "15.0.0" },
        }),
      }),
    );

    expect(detected.runtimeVersion).toBe("1.3.14");
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
          dependencies: { express: "4.0.0" },
        }),
      }),
    );

    expect(detected.framework).toBe("node");
    expect(detected.startCommand).toBe("npm run start");
    expect(detected.buildCommand).toBeNull();
  });

  it("uses the forced preset instead of matching one", async () => {
    // A repository whose dependencies do not say what it is still has to be
    // deployable, which is what the form's preset picker is for.
    const detected = await detectBuildConfig(
      repo({
        "": ["package.json", "bun.lock"],
        "package.json": pkg({ dependencies: { express: "4.0.0" } }),
      }),
      "",
      { framework: "vite" },
    );

    expect(detected.framework).toBe("vite");
    expect(detected.buildCommand).toBe("bunx --bun vite build");
  });
});

describe("resolveBuildConfig", () => {
  const tree = repo({
    "": ["package.json", "bun.lock"],
    "package.json": pkg({
      scripts: { build: "next build", start: "next start" },
      dependencies: { next: "15.0.0" },
    }),
  });

  it("reports the preset's answer when nothing overrides it", async () => {
    const resolved = await resolveBuildConfig(tree);

    expect(resolved.framework).toBe("nextjs");
    expect(resolved.buildCommand).toEqual({
      value: "bun run build",
      source: "preset",
    });
  });

  it("keeps the preset value visible beside an override", async () => {
    const resolved = await resolveBuildConfig(tree, {
      overrides: { startCommand: "node server.js" },
    });

    expect(resolved.startCommand).toEqual({
      value: "node server.js",
      source: "override",
    });
    // Untouched fields stay the preset's, so clearing one override does not
    // strand the others.
    expect(resolved.buildCommand.source).toBe("preset");
  });

  it("reads builder 'auto' as the absence of a choice", async () => {
    // It is the column default every target starts with. Treating it as an
    // override would pin every target to whatever its first import resolved.
    const resolved = await resolveBuildConfig(tree, {
      overrides: { builder: "auto" },
    });

    expect(resolved.builder).toEqual({ value: "nixpacks", source: "preset" });
  });

  it("honours a pinned version for the runtime that will run", async () => {
    const resolved = await resolveBuildConfig(tree, {
      overrides: { runtimeVersion: "1.3.0" },
    });

    expect(resolved.runtime).toEqual({ value: "bun", source: "preset" });
    expect(resolved.runtimeVersion).toEqual({
      value: "1.3.0",
      source: "override",
    });
  });

  it("replaces a version stranded by a runtime override", async () => {
    // The column still holds "22" from when this was a Node target. Carrying
    // it across would ask the Bun path for a version that does not exist.
    const resolved = await resolveBuildConfig(tree, {
      overrides: { runtime: "node", runtimeVersion: "1.3.14" },
    });

    expect(resolved.runtime).toEqual({ value: "node", source: "override" });
    expect(resolved.runtimeVersion).toEqual({ value: "22", source: "preset" });
  });

  it("moves the preset version to the overridden runtime's default", async () => {
    const nodeRepo = repo({
      "": ["package.json", "package-lock.json"],
      "package.json": pkg({ dependencies: { next: "15.0.0" } }),
    });
    const resolved = await resolveBuildConfig(nodeRepo, {
      overrides: { runtime: "bun" },
    });

    expect(resolved.runtimeVersion).toEqual({
      value: "1.3.14",
      source: "preset",
    });
  });
});

describe("detectWorkspaceContext", () => {
  it("reads the package manager, turbo and the workspace list from the root", async () => {
    const context = await detectWorkspaceContext(
      repo({
        "": ["package.json", "bun.lock", "turbo.json", "apps/"],
        "package.json": pkg({ workspaces: ["apps/*"] }),
        "turbo.json": JSON.stringify({ tasks: {} }),
        apps: ["api/", "web/"],
      }),
    );

    expect(context.packageManager).toBe("bun");
    expect(context.isTurbo).toBe(true);
    expect(context.isMonorepo).toBe(true);
    expect(context.workspaces.map((entry) => entry.path)).toEqual([
      "apps/api",
      "apps/web",
    ]);
  });

  it("reports a plain repository as neither", async () => {
    const context = await detectWorkspaceContext(
      repo({
        "": ["package.json", "package-lock.json"],
        "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      }),
    );

    expect(context.isTurbo).toBe(false);
    expect(context.isMonorepo).toBe(false);
    expect(context.packageManager).toBe("npm");
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
