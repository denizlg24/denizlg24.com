import {
  canonicalizeGitHubRepositoryUrl,
  parseGitHubRepositoryInput,
} from "@/lib/github-repository-context";
import { type ILeanProject, type ILink, Project } from "@/models/Project";
import { connectDB } from "./mongodb";

export interface SaveGitHubProjectDraftInput {
  sourceRepositoryUrl: string;
  sourceBranch?: string;
  title: string;
  subtitle: string;
  markdown: string;
  tags: string[];
  demoUrl?: string;
}

export interface SaveGitHubProjectDraftResult {
  action: "created" | "updated";
  project: ILeanProject;
}

type SerializableLink = Pick<ILink, "label" | "url" | "icon">;
type StringableId = { toString(): string };
type SerializableProject = Omit<ILeanProject, "_id" | "links"> & {
  _id: StringableId;
  links: Array<
    SerializableLink & {
      _id: StringableId;
    }
  >;
};

function serializeProject(project: SerializableProject): ILeanProject {
  return {
    ...project,
    _id: project._id.toString(),
    links: project.links.map((link) => ({
      ...link,
      _id: link._id.toString(),
    })),
  };
}

function normalizePublicUrl(url: string): string {
  const parsed = new URL(url.trim());

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("demoUrl must use http or https.");
  }

  parsed.hash = "";

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function normalizeDemoUrl(
  demoUrl: string | undefined,
  repositoryUrl: string,
): string | undefined {
  if (!demoUrl?.trim()) return undefined;

  const normalizedDemoUrl = normalizePublicUrl(demoUrl);
  return normalizedDemoUrl === repositoryUrl ? undefined : normalizedDemoUrl;
}

function sanitizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function isMatchingGitHubRepositoryUrl(
  url: string,
  canonicalRepositoryUrl: string,
): boolean {
  try {
    return canonicalizeGitHubRepositoryUrl(url) === canonicalRepositoryUrl;
  } catch {
    return false;
  }
}

export function buildProjectDraftLinks({
  existingLinks = [],
  canonicalRepositoryUrl,
  demoUrl,
}: {
  existingLinks?: SerializableLink[];
  canonicalRepositoryUrl: string;
  demoUrl?: string;
}): SerializableLink[] {
  const preservedLinks = existingLinks.filter((link) => {
    const isRepositoryLink =
      (link.label === "Repository" && link.icon === "github") ||
      isMatchingGitHubRepositoryUrl(link.url, canonicalRepositoryUrl);

    const isWebsiteLink = link.label === "Website" && link.icon === "external";

    return !isRepositoryLink && !isWebsiteLink;
  });

  const nextLinks: SerializableLink[] = [
    {
      label: "Repository",
      url: canonicalRepositoryUrl,
      icon: "github",
    },
  ];

  if (demoUrl) {
    nextLinks.push({
      label: "Website",
      url: demoUrl,
      icon: "external",
    });
  }

  nextLinks.push(...preservedLinks);

  return nextLinks;
}

async function findExistingProjectByRepository(canonicalRepositoryUrl: string) {
  const repository = parseGitHubRepositoryInput(canonicalRepositoryUrl);

  const structuredMatches = await Project.find({
    "sourceRepository.provider": "github",
    "sourceRepository.owner": repository.owner,
    "sourceRepository.repo": repository.repo,
  })
    .sort({ isActive: -1, order: 1 })
    .exec();

  const activeStructuredMatch = structuredMatches.find(
    (project) => project.isActive,
  );
  if (activeStructuredMatch) return activeStructuredMatch;

  const inactiveStructuredMatch = structuredMatches.find(
    (project) => !project.isActive,
  );
  if (inactiveStructuredMatch) return inactiveStructuredMatch;

  const legacyCandidates = await Project.find({
    links: { $elemMatch: { icon: "github" } },
  })
    .sort({ isActive: -1, order: 1 })
    .exec();

  return (
    legacyCandidates.find((project) =>
      project.links.some((link) =>
        isMatchingGitHubRepositoryUrl(link.url, canonicalRepositoryUrl),
      ),
    ) ?? null
  );
}

async function getNextProjectOrder(): Promise<number> {
  const maxOrderProject = await Project.findOne()
    .sort({ order: -1 })
    .select("order")
    .lean()
    .exec();

  return maxOrderProject ? maxOrderProject.order + 1 : 1;
}

export async function getProjectTags() {
  await connectDB();
  const tags = await Project.distinct("tags");
  return tags;
}

export async function getFilteredActiveProjects({
  tags,
  query,
}: {
  tags: string[];
  query: string;
}) {
  await connectDB();
  const filter: Record<string, unknown> = { isActive: true };

  if (tags.length > 0) {
    filter.tags = { $all: tags };
  }

  if (query) {
    filter.$or = [
      { title: { $regex: query, $options: "i" } },
      { subtitle: { $regex: query, $options: "i" } },
      { description: { $regex: query, $options: "i" } },
      { tags: { $regex: query, $options: "i" } },
    ];
  }

  const projects = await Project.find(filter).sort({ order: 1 }).lean().exec();
  return projects.map((project) => serializeProject(project));
}

export async function getAllProjects() {
  await connectDB();
  const projects = await Project.find().sort({ order: 1 }).lean().exec();
  return projects.map((project) => serializeProject(project));
}

export async function getActiveProjects() {
  await connectDB();
  const projects = await Project.find({ isActive: true })
    .sort({ order: 1 })
    .lean()
    .exec();
  return projects.map((project) => serializeProject(project));
}

export async function getProjectById(id: string) {
  await connectDB();
  const project = await Project.findById(id).lean().exec();
  if (!project) return null;

  return serializeProject(project);
}

export async function toggleProjectActive(id: string) {
  await connectDB();
  const project = await Project.findById(id);
  if (!project) return null;

  project.isActive = !project.isActive;
  await project.save();

  return serializeProject(project.toObject());
}

export async function saveGitHubProjectDraft(
  input: SaveGitHubProjectDraftInput,
): Promise<SaveGitHubProjectDraftResult> {
  const repository = parseGitHubRepositoryInput(input.sourceRepositoryUrl);
  const canonicalRepositoryUrl = repository.url;
  const normalizedDemoUrl = normalizeDemoUrl(
    input.demoUrl,
    canonicalRepositoryUrl,
  );
  const sourceBranch = input.sourceBranch?.trim() || undefined;
  const tags = sanitizeTags(input.tags);

  await connectDB();

  const existingProject = await findExistingProjectByRepository(
    canonicalRepositoryUrl,
  );

  if (existingProject?.isActive) {
    throw new Error(
      `A published project already exists for ${repository.fullName} (projectId: ${existingProject._id.toString()}).`,
    );
  }

  if (existingProject) {
    const updatedProject = await Project.findByIdAndUpdate(
      existingProject._id,
      {
        title: input.title,
        subtitle: input.subtitle,
        markdown: input.markdown,
        tags,
        links: buildProjectDraftLinks({
          existingLinks: existingProject.links.map((link) => ({
            label: link.label,
            url: link.url,
            icon: link.icon,
          })),
          canonicalRepositoryUrl,
          demoUrl: normalizedDemoUrl,
        }),
        sourceRepository: {
          provider: "github",
          owner: repository.owner,
          repo: repository.repo,
          url: canonicalRepositoryUrl,
          branch: sourceBranch,
        },
        isActive: false,
        isFeatured: false,
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .lean()
      .exec();

    if (!updatedProject) {
      throw new Error("Project draft could not be updated.");
    }

    return {
      action: "updated",
      project: serializeProject(updatedProject),
    };
  }

  const createdProject = await Project.create({
    title: input.title,
    subtitle: input.subtitle,
    images: [],
    media: [],
    links: buildProjectDraftLinks({
      canonicalRepositoryUrl,
      demoUrl: normalizedDemoUrl,
    }),
    sourceRepository: {
      provider: "github",
      owner: repository.owner,
      repo: repository.repo,
      url: canonicalRepositoryUrl,
      branch: sourceBranch,
    },
    markdown: input.markdown,
    tags,
    isActive: false,
    isFeatured: false,
    order: await getNextProjectOrder(),
  });

  return {
    action: "created",
    project: serializeProject(createdProject.toObject()),
  };
}
