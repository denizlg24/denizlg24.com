import { describe, expect, test } from "bun:test";
import {
  parseGitHubRepositoryInput,
  selectGitHubRepositoryFiles,
} from "./github-repository-context";

describe("parseGitHubRepositoryInput", () => {
  test("parses full GitHub URLs", () => {
    expect(
      parseGitHubRepositoryInput("https://github.com/vercel/next.js"),
    ).toEqual({
      owner: "vercel",
      repo: "next.js",
      fullName: "vercel/next.js",
      url: "https://github.com/vercel/next.js",
    });
  });

  test("parses owner/repo identifiers", () => {
    expect(parseGitHubRepositoryInput("oven-sh/bun")).toEqual({
      owner: "oven-sh",
      repo: "bun",
      fullName: "oven-sh/bun",
      url: "https://github.com/oven-sh/bun",
    });
  });

  test("rejects non-GitHub URLs", () => {
    expect(() =>
      parseGitHubRepositoryInput("https://gitlab.com/acme/project"),
    ).toThrow("Only GitHub repositories are supported.");
  });
});

describe("selectGitHubRepositoryFiles", () => {
  const tree = [
    { path: "README.md", type: "blob", sha: "1", size: 1200 },
    { path: "package.json", type: "blob", sha: "2", size: 800 },
    { path: "next.config.ts", type: "blob", sha: "3", size: 300 },
    { path: "src/app/page.tsx", type: "blob", sha: "4", size: 1500 },
    { path: "src/lib/worker.ts", type: "blob", sha: "5", size: 900 },
    { path: ".env.local", type: "blob", sha: "6", size: 100 },
    { path: "certs/server.pem", type: "blob", sha: "7", size: 500 },
    { path: "public/logo.png", type: "blob", sha: "8", size: 9000 },
    { path: "bun.lock", type: "blob", sha: "9", size: 40000 },
  ] as const;

  test("selects readme, manifest, config, and entry files", () => {
    const result = selectGitHubRepositoryFiles({
      tree: [...tree],
    });

    expect(result.selected.map((file) => file.path)).toEqual([
      "README.md",
      "package.json",
      "next.config.ts",
      "src/app/page.tsx",
    ]);
  });

  test("excludes secret-like, binary/media, and huge lockfiles", () => {
    const result = selectGitHubRepositoryFiles({
      tree: [...tree],
      maxFiles: 12,
    });

    const selectedPaths = result.selected.map((file) => file.path);

    expect(selectedPaths).not.toContain(".env.local");
    expect(selectedPaths).not.toContain("certs/server.pem");
    expect(selectedPaths).not.toContain("public/logo.png");
    expect(selectedPaths).not.toContain("bun.lock");
  });

  test("includePaths forces additional file inclusion", () => {
    const result = selectGitHubRepositoryFiles({
      tree: [...tree],
      includePaths: ["src/lib/worker.ts"],
      maxFiles: 5,
    });

    expect(result.selected.map((file) => file.path)).toContain(
      "src/lib/worker.ts",
    );
    expect(
      result.selected.find((file) => file.path === "src/lib/worker.ts")?.reason,
    ).toBe("Explicitly requested via includePaths.");
  });

  test("caps maxFiles at the hard limit", () => {
    const result = selectGitHubRepositoryFiles({
      tree: [...tree],
      maxFiles: 999,
    });

    expect(result.warnings).toContain(
      "maxFiles was capped at 12 to stay within tool limits.",
    );
    expect(result.selected.length).toBeLessThanOrEqual(12);
  });
});
