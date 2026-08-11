import { describe, expect, it } from "bun:test";

import type { RepoInspector } from "../detect";
import type { ModuleGraph } from "../module-graph";
import { createRepositoryChangeMatcher } from "./changes";

function pkg(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function repository(): RepoInspector {
  const files = new Map<string, string>([
    ["package.json", pkg({ workspaces: ["apps/*", "packages/*"] })],
    [
      "apps/web/package.json",
      pkg({
        name: "web",
        dependencies: { "@repo/ui": "workspace:*" },
      }),
    ],
    ["apps/api/package.json", pkg({ name: "api" })],
    [
      "packages/ui/package.json",
      pkg({
        name: "@repo/ui",
        dependencies: { "@repo/tokens": "workspace:*" },
      }),
    ],
    ["packages/tokens/package.json", pkg({ name: "@repo/tokens" })],
    ["packages/unrelated/package.json", pkg({ name: "@repo/unrelated" })],
  ]);
  const directories = new Map<string, string[]>([
    ["apps", ["api", "web"]],
    ["packages", ["tokens", "ui", "unrelated"]],
  ]);
  return {
    readFile: async (path) => files.get(path) ?? null,
    listDirectory: async (path) =>
      (directories.get(path) ?? []).map((name) => ({
        name,
        type: "dir" as const,
      })),
  };
}

async function matcher(...changedFiles: string[]) {
  return createRepositoryChangeMatcher(repository(), changedFiles);
}

const WEB = { rootDirectory: "apps/web" };

describe("RepositoryChangeMatcher", () => {
  it("deploys for a file inside the target", async () => {
    expect((await matcher("apps/web/app/page.tsx")).affectsTarget(WEB)).toBe(
      true,
    );
  });

  it("skips a different application in the same repository", async () => {
    expect((await matcher("apps/api/src/index.ts")).affectsTarget(WEB)).toBe(
      false,
    );
  });

  it("deploys for transitive workspace dependencies", async () => {
    expect(
      (await matcher("packages/tokens/src/colors.ts")).affectsTarget(WEB),
    ).toBe(true);
  });

  it("skips an unrelated workspace package", async () => {
    expect(
      (await matcher("packages/unrelated/src/index.ts")).affectsTarget(WEB),
    ).toBe(false);
  });

  it("treats files outside declared workspaces as global build inputs", async () => {
    expect((await matcher("bun.lock")).affectsTarget(WEB)).toBe(true);
    expect((await matcher("scripts/postinstall.mjs")).affectsTarget(WEB)).toBe(
      true,
    );
  });

  it("deploys when a configured Dockerfile changes outside the target", async () => {
    expect(
      (await matcher("docker/web.Dockerfile")).affectsTarget({
        ...WEB,
        dockerfilePath: "docker/web.Dockerfile",
      }),
    ).toBe(true);
  });

  it("always deploys a repository-root target", async () => {
    expect(
      (await matcher("apps/api/src/index.ts")).affectsTarget({
        rootDirectory: null,
      }),
    ).toBe(true);
  });

  it("fails open when a workspace dependency cannot be resolved", async () => {
    const repo = repository();
    const originalRead = repo.readFile;
    repo.readFile = async (path) =>
      path === "packages/ui/package.json" ? null : originalRead(path);
    const result = await createRepositoryChangeMatcher(repo, [
      "packages/unrelated/src/index.ts",
    ]);
    expect(result.affectsTarget(WEB)).toBe(true);
  });

  it("fails open when a declared workspace manifest cannot be parsed", async () => {
    const repo = repository();
    const originalRead = repo.readFile;
    repo.readFile = async (path) =>
      path === "packages/unrelated/package.json"
        ? "{ not valid json"
        : originalRead(path);
    const result = await createRepositoryChangeMatcher(repo, [
      "apps/api/src/index.ts",
    ]);
    expect(result.affectsTarget(WEB)).toBe(true);
  });

  // A directory matched by `apps/*` that holds a Cargo, Go or Python project has
  // no `package.json` and never will. Counting it as a missing manifest made the
  // graph permanently incomplete, which made every target deploy on every push.
  describe("workspaces that are not JavaScript packages", () => {
    function polyglot(): RepoInspector {
      const repo = repository();
      const originalList = repo.listDirectory;
      repo.listDirectory = async (path) =>
        path === "apps"
          ? [
              { name: "api", type: "dir" as const },
              { name: "web", type: "dir" as const },
              { name: "envoy-cli", type: "dir" as const },
              { name: "ssh-server", type: "dir" as const },
            ]
          : originalList(path);
      return repo;
    }

    it("still skips an unrelated change", async () => {
      const result = await createRepositoryChangeMatcher(polyglot(), [
        "apps/api/src/index.ts",
      ]);
      expect(result.affectsTarget(WEB)).toBe(false);
    });

    it("does not fan a change inside one out to every other target", async () => {
      const result = await createRepositoryChangeMatcher(polyglot(), [
        "apps/envoy-cli/src/main.rs",
      ]);
      expect(result.affectsTarget(WEB)).toBe(false);
    });

    it("still deploys a target rooted in one when its own files change", async () => {
      const result = await createRepositoryChangeMatcher(polyglot(), [
        "apps/envoy-cli/src/main.rs",
      ]);
      expect(result.affectsTarget({ rootDirectory: "apps/envoy-cli" })).toBe(
        true,
      );
    });

    it("skips a target rooted in one when an unrelated package changes", async () => {
      const result = await createRepositoryChangeMatcher(polyglot(), [
        "packages/unrelated/src/index.ts",
      ]);
      expect(result.affectsTarget({ rootDirectory: "apps/envoy-cli" })).toBe(
        false,
      );
    });
  });

  // The package-level answer is "web depends on @repo/tokens", which is true and
  // does not mean web reads the file that changed.
  describe("with an import graph from the last build", () => {
    const graph: ModuleGraph = {
      sha: "abc1234",
      rootDirectory: "apps/web",
      files: ["packages/ui/src/index.ts", "packages/tokens/src/colors.ts"],
      opaqueWorkspaces: [],
      complete: true,
    };

    it("skips a dependency file the target does not import", async () => {
      const decision = (await matcher("packages/tokens/src/spacing.ts")).decide(
        { ...WEB, moduleGraph: graph },
      );
      expect(decision).toEqual({
        deploy: false,
        reason: "unimported-files",
        files: [],
      });
    });

    it("deploys for a dependency file the target does import", async () => {
      const decision = (await matcher("packages/tokens/src/colors.ts")).decide({
        ...WEB,
        moduleGraph: graph,
      });
      expect(decision.deploy).toBe(true);
      expect(decision.reason).toBe("dependency-imported");
    });

    it("deploys when only one of several changed files is imported", async () => {
      const decision = (
        await matcher(
          "packages/tokens/src/spacing.ts",
          "packages/tokens/src/colors.ts",
        )
      ).decide({ ...WEB, moduleGraph: graph });
      expect(decision.deploy).toBe(true);
      expect(decision.files).toEqual(["packages/tokens/src/colors.ts"]);
    });

    it("deploys for a dependency manifest the walk never opened", async () => {
      const decision = (await matcher("packages/tokens/package.json")).decide({
        ...WEB,
        moduleGraph: graph,
      });
      expect(decision.deploy).toBe(true);
    });

    it("ignores a graph resolved for a different root directory", async () => {
      const decision = (await matcher("packages/tokens/src/spacing.ts")).decide(
        {
          ...WEB,
          moduleGraph: { ...graph, rootDirectory: "apps/api" },
        },
      );
      expect(decision).toEqual({
        deploy: true,
        reason: "dependency-unresolved",
        files: ["packages/tokens/src/spacing.ts"],
      });
    });

    it("ignores an incomplete graph", async () => {
      const decision = (await matcher("packages/tokens/src/spacing.ts")).decide(
        { ...WEB, moduleGraph: { ...graph, complete: false } },
      );
      expect(decision.deploy).toBe(true);
      expect(decision.reason).toBe("dependency-unresolved");
    });

    it("still deploys for the target's own files", async () => {
      const decision = (await matcher("apps/web/app/page.tsx")).decide({
        ...WEB,
        moduleGraph: graph,
      });
      expect(decision.reason).toBe("own-files");
    });

    it("still deploys for a global input", async () => {
      const decision = (await matcher("bun.lock")).decide({
        ...WEB,
        moduleGraph: graph,
      });
      expect(decision.reason).toBe("global-inputs");
    });
  });
});
