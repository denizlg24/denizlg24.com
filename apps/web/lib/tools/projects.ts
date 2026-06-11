import { getGitHubRepositoryContext } from "@/lib/github-repository-context";
import {
  getAllProjects,
  getProjectById,
  saveGitHubProjectDraft,
} from "@/lib/projects";
import type { ToolDefinition } from "./types";

export const projectsTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_projects",
      description:
        "List all portfolio projects with their titles, tags, visibility, and links.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "projects",
    execute: async () => {
      const projects = await getAllProjects();
      return projects.map((project) => ({
        _id: project._id,
        title: project.title,
        subtitle: project.subtitle,
        tags: project.tags,
        isActive: project.isActive,
        isFeatured: project.isFeatured,
        links: project.links,
        sourceRepository: project.sourceRepository,
      }));
    },
  },
  {
    schema: {
      name: "get_project",
      description:
        "Get full details of a project by its ID, including markdown content.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Project ID" },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "projects",
    execute: async (input) => {
      const project = await getProjectById(input.id as string);
      if (!project) throw new Error("Project not found");
      return project;
    },
  },
  {
    schema: {
      name: "get_github_repository_context",
      description:
        "Inspect a GitHub repository so you can draft a portfolio project from its code, docs, and metadata.",
      input_schema: {
        type: "object",
        properties: {
          repository: {
            type: "string",
            description: "GitHub repository URL or owner/repo identifier.",
          },
          branch: {
            type: "string",
            description:
              "Branch to inspect. Defaults to the repository default branch.",
          },
          includePaths: {
            type: "array",
            description:
              "Specific repository file paths to force-include in addition to the default selection.",
            items: { type: "string" },
          },
          maxFiles: {
            type: "number",
            description:
              "Maximum number of files to inspect. Defaults to 8 and is capped at 12.",
          },
        },
        required: ["repository"],
      },
    },
    isWrite: false,
    category: "projects",
    execute: async (input) => {
      return getGitHubRepositoryContext({
        repository: input.repository as string,
        branch: input.branch as string | undefined,
        includePaths: input.includePaths as string[] | undefined,
        maxFiles: input.maxFiles as number | undefined,
      });
    },
  },
  {
    schema: {
      name: "save_project_draft",
      description:
        "Create or update a hidden project draft sourced from a GitHub repository. Drafts stay inactive and unfeatured.",
      input_schema: {
        type: "object",
        properties: {
          sourceRepositoryUrl: {
            type: "string",
            description:
              "Canonical GitHub repository URL for the project source.",
          },
          sourceBranch: {
            type: "string",
            description: "Branch used when reviewing the source repository.",
          },
          title: {
            type: "string",
            description: "Project title.",
          },
          subtitle: {
            type: "string",
            description: "Project subtitle or short summary.",
          },
          markdown: {
            type: "string",
            description: "Full project write-up in markdown.",
          },
          tags: {
            type: "array",
            description: "Project tags.",
            items: { type: "string" },
          },
          demoUrl: {
            type: "string",
            description:
              "Optional live demo or homepage URL. It is omitted if it matches the repository URL.",
          },
        },
        required: [
          "sourceRepositoryUrl",
          "title",
          "subtitle",
          "markdown",
          "tags",
        ],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      return saveGitHubProjectDraft({
        sourceRepositoryUrl: input.sourceRepositoryUrl as string,
        sourceBranch: input.sourceBranch as string | undefined,
        title: input.title as string,
        subtitle: input.subtitle as string,
        markdown: input.markdown as string,
        tags: input.tags as string[],
        demoUrl: input.demoUrl as string | undefined,
      });
    },
  },
];
