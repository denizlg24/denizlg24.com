import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Api, defineTool, p } from "../define";

const repo = {
  owner: z.string().min(1),
  repo: z.string().min(1),
};

export function registerForgeGithub(server: McpServer, api: Api) {
  defineTool(server, {
    name: "forge_github_connection_get",
    title: "Forge: GitHub connection",
    description: "The GitHub App installations Forge can deploy from.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/deploy/github/connection"),
  });

  defineTool(server, {
    name: "forge_github_installations_sync",
    title: "Forge: sync GitHub installations",
    description:
      "Re-reads the GitHub App installations and their repositories.",
    input: z.object({}),
    annotations: { idempotentHint: true },
    run: () => api.cloud.post("/api/deploy/github/installations/sync"),
  });

  defineTool(server, {
    name: "forge_github_repositories_list",
    title: "Forge: GitHub repositories",
    description:
      "Repositories the installations expose. includeBadges adds deployed/target badges per repository.",
    input: z.object({ includeBadges: z.boolean().optional() }),
    annotations: { readOnlyHint: true },
    run: async ({ includeBadges }) => {
      const repositories = await api.cloud.get(
        "/api/deploy/github/repositories",
      );
      if (!includeBadges || repositories.isError) return repositories;
      const data = repositories.structuredContent?.data;
      const listed = z
        .array(z.object({ owner: z.string(), name: z.string() }))
        .safeParse(data);
      // The badge route accepts thirty repositories per call.
      const repos = listed.success ? listed.data.slice(0, 30) : [];
      if (repos.length === 0) return repositories;
      const badges = await api.cloud.post("/api/deploy/github/repos/badges", {
        repos: repos.map(({ owner, name }) => ({ owner, name })),
      });
      return {
        ...repositories,
        structuredContent: {
          ...repositories.structuredContent,
          badges: badges.structuredContent?.data ?? null,
        },
      };
    },
  });

  defineTool(server, {
    name: "forge_github_repo_branches",
    title: "Forge: repository branches",
    description: "Branches of one repository.",
    input: z.object(repo),
    annotations: { readOnlyHint: true },
    run: ({ owner, repo }) =>
      api.cloud.get(p`/api/deploy/github/repos/${owner}/${repo}/branches`),
  });

  defineTool(server, {
    name: "forge_github_repo_tree",
    title: "Forge: repository tree",
    description: "One directory level of a repository at a ref.",
    input: z.object({
      ...repo,
      path: z.string().optional().describe("Directory, default root"),
      ref: z.string().optional().describe("Branch, tag or sha"),
    }),
    annotations: { readOnlyHint: true },
    run: ({ owner, repo, path, ref }) =>
      api.cloud.get(p`/api/deploy/github/repos/${owner}/${repo}/tree`, {
        path,
        ref,
      }),
  });

  defineTool(server, {
    name: "forge_github_repo_detect",
    title: "Forge: detect build config",
    description:
      "What Forge would infer for a repository: framework, builder, runtime, commands.",
    input: z.object({
      ...repo,
      ref: z.string().optional(),
      dir: z.string().optional().describe("Root directory inside the repo"),
      framework: z.string().optional().describe("Force a framework preset"),
    }),
    annotations: { readOnlyHint: true },
    run: ({ owner, repo, ref, dir, framework }) =>
      api.cloud.get(p`/api/deploy/github/repos/${owner}/${repo}/detect`, {
        ref,
        dir,
        framework,
      }),
  });
}
