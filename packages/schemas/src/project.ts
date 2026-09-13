import { z } from "zod";

export const DEFAULT_PROJECT_TOPIC_GROUPS = [
  "Frontend",
  "Fullstack",
  "Infrastructure",
  "Hardware/Software",
  "Other",
] as const;
export type DefaultProjectTopicGroup =
  (typeof DEFAULT_PROJECT_TOPIC_GROUPS)[number];

export const sourceRepositorySchema = z.object({
  provider: z.literal("github"),
  owner: z.string(),
  repo: z.string(),
  url: z.string(),
  branch: z.string().optional(),
});
export type ISourceRepository = z.infer<typeof sourceRepositorySchema>;

export const projectLinkSchema = z.object({
  _id: z.string(),
  label: z.string(),
  url: z.string(),
  icon: z.enum(["external", "github", "notepad"]),
});

export const projectSchema = z.object({
  _id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  images: z.array(z.string()),
  media: z.array(z.string()).optional(),
  links: z.array(projectLinkSchema),
  sourceRepository: sourceRepositorySchema.optional(),
  markdown: z.string(),
  tags: z.array(z.string()),
  topicGroups: z.array(z.string()).optional(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IProject = z.infer<typeof projectSchema>;

export const timelineItemSchema = z.object({
  _id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  logoUrl: z.string().optional(),
  dateFrom: z.string(),
  dateTo: z.string().optional(),
  topics: z.array(z.string()),
  category: z.enum(["work", "education", "personal"]),
  order: z.number(),
  links: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        icon: z.enum(["external", "github", "notepad"]),
      }),
    )
    .optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ITimelineItem = z.infer<typeof timelineItemSchema>;

export const nowPageSchema = z.object({
  _id: z.string(),
  content: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type INowPage = z.infer<typeof nowPageSchema>;

export const githubRepositoryContextRequestSchema = z.object({
  repository: z.string().min(1).describe("owner/name or a github.com URL"),
  branch: z.string().min(1).optional(),
  includePaths: z.array(z.string().min(1)).optional(),
  maxFiles: z.number().int().min(1).max(12).optional(),
});
export type GithubRepositoryContextRequest = z.infer<
  typeof githubRepositoryContextRequestSchema
>;

/** A hidden project draft sourced from a repository; stays inactive and unfeatured. */
export const projectDraftInputSchema = z.object({
  sourceRepositoryUrl: z.string().min(1),
  sourceBranch: z.string().min(1).optional(),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  markdown: z.string().min(1),
  tags: z.array(z.string()),
  demoUrl: z.string().optional(),
});
export type ProjectDraftInput = z.infer<typeof projectDraftInputSchema>;
