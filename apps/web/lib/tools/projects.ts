import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { getGitHubRepositoryContext } from "@/lib/github-repository-context";
import {
  createProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  type ProjectWriteInput,
  reorderProjects,
  saveGitHubProjectDraft,
  toggleProjectActive,
  toggleProjectFeatured,
  updateProject,
} from "@/lib/projects";
import { revalidateProjectsContent } from "@/lib/public-content-revalidation";
import type { ToolDefinition } from "./types";

const PROJECT_WRITE_PROPERTIES = {
  title: { type: "string", description: "Project title." },
  subtitle: { type: "string", description: "Short summary line." },
  markdown: { type: "string", description: "Full write-up in markdown." },
  tags: {
    type: "array",
    description: "Project tags.",
    items: { type: "string" },
  },
  topicGroups: {
    type: "array",
    description: "Topic groups used to cluster projects on the public site.",
    items: { type: "string" },
  },
  images: {
    type: "array",
    description: "Image URLs already uploaded to storage.",
    items: { type: "string" },
  },
  isActive: {
    type: "boolean",
    description: "Whether the project is published on the public site.",
  },
  isFeatured: {
    type: "boolean",
    description: "Whether the project is featured.",
  },
} as const;

function projectWriteInput(input: Record<string, unknown>): ProjectWriteInput {
  return {
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.subtitle === "string" ? { subtitle: input.subtitle } : {}),
    ...(typeof input.markdown === "string" ? { markdown: input.markdown } : {}),
    ...(Array.isArray(input.tags) ? { tags: input.tags as string[] } : {}),
    ...(input.topicGroups !== undefined
      ? { topicGroups: input.topicGroups }
      : {}),
    ...(Array.isArray(input.images)
      ? { images: input.images as string[] }
      : {}),
    ...(typeof input.isActive === "boolean"
      ? { isActive: input.isActive }
      : {}),
    ...(typeof input.isFeatured === "boolean"
      ? { isFeatured: input.isFeatured }
      : {}),
  };
}

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
  {
    schema: {
      name: "create_project",
      description:
        "Create a portfolio project. Defaults to unpublished and unfeatured; pass isActive to publish it immediately.",
      input_schema: {
        type: "object",
        properties: PROJECT_WRITE_PROPERTIES,
        required: ["title", "subtitle", "markdown"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const project = await createProject(projectWriteInput(input));
      revalidateProjectsContent();
      return project;
    },
  },
  {
    schema: {
      name: "update_project",
      description:
        "Update a portfolio project. Only the fields you pass are changed; read the project first when rewriting markdown.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Project ID" },
          ...PROJECT_WRITE_PROPERTIES,
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const project = await updateProject(
        input.id as string,
        projectWriteInput(input),
      );
      if (!project) throw new Error("Project not found");
      revalidateProjectsContent();
      return project;
    },
  },
  {
    schema: {
      name: "toggle_project_active",
      description:
        "Flip a project's published state on the public site. Use update_project when you need to set it to a specific value.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Project ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const project = await toggleProjectActive(input.id as string);
      if (!project) throw new Error("Project not found");
      revalidateProjectsContent();
      return project;
    },
  },
  {
    schema: {
      name: "toggle_project_featured",
      description: "Flip a project's featured state.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Project ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const project = await toggleProjectFeatured(input.id as string);
      if (!project) throw new Error("Project not found");
      revalidateProjectsContent();
      return project;
    },
  },
  {
    schema: {
      name: "reorder_projects",
      description:
        "Set the public display order of projects. Pass project IDs in the order they should appear; omitted projects keep their current order.",
      input_schema: {
        type: "object",
        properties: {
          orderedIds: {
            type: "array",
            description: "Project IDs in display order.",
            items: { type: "string" },
          },
        },
        required: ["orderedIds"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const orderedIds = Array.isArray(input.orderedIds)
        ? (input.orderedIds as string[])
        : [];
      if (orderedIds.length === 0) throw new Error("orderedIds is required");
      const projects = await reorderProjects(orderedIds);
      revalidateProjectsContent();
      return projects.map((project) => ({
        _id: project._id,
        title: project.title,
        order: project.order,
      }));
    },
  },
  {
    schema: {
      name: "delete_project",
      description:
        "Permanently delete a portfolio project and redact it from agent memory.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Project ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "projects",
    execute: async (input) => {
      const id = input.id as string;
      const project = await getProjectById(id);
      if (!project) throw new Error("Project not found");
      await redactAgentMemorySource({ entityType: "project", entityId: id });
      const deleted = await deleteProject(id);
      revalidateProjectsContent();
      return { deleted, title: project.title };
    },
  },
];
