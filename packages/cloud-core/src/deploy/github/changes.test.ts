import { describe, expect, it } from "bun:test";

import type { RepoInspector } from "../detect";
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

  it("fails open when any declared workspace manifest is unreadable", async () => {
    const repo = repository();
    const originalRead = repo.readFile;
    repo.readFile = async (path) =>
      path === "packages/unrelated/package.json" ? null : originalRead(path);
    const result = await createRepositoryChangeMatcher(repo, [
      "apps/api/src/index.ts",
    ]);
    expect(result.affectsTarget(WEB)).toBe(true);
  });
});
