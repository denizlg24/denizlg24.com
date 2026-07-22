import "server-only";

import type {
  AcceptLatexReferenceInput,
  ILatexFileEntry,
  ILatexProjectRecord,
  LatexReferenceSuggestion,
  PaperAuthor,
} from "@repo/schemas";
import mongoose from "mongoose";
import { getLatexProject, updateLatexProject } from "@/lib/latex-projects";
import {
  isAlreadyCited,
  normalizedReferenceTitle,
  projectCitationIndex,
} from "@/lib/latex-reference-citations";
import { connectDB } from "@/lib/mongodb";
import { searchOpenAlex } from "@/lib/openalex";
import { normalizeDoi, serializePaper } from "@/lib/paper-citations";
import { createPaperWithLinkedNote } from "@/lib/paper-notes";
import { LatexProjectReference } from "@/models/LatexProjectReference";
import { type ILeanPaper, Paper } from "@/models/Paper";

function suggestionKey(value: LatexReferenceSuggestion): string {
  if (value.doi) return `doi:${normalizeDoi(value.doi) ?? value.doi}`;
  if (value.openAlexId) return `openalex:${value.openAlexId.toLowerCase()}`;
  if (value.arxivId) return `arxiv:${value.arxivId.toLowerCase()}`;
  return `title:${normalizedReferenceTitle(value.title)}`;
}

function paperAuthors(authors: PaperAuthor[]): PaperAuthor[] {
  return authors.slice(0, 100).map((author) => ({ ...author }));
}

export function localPaperSuggestion(
  paper: ILeanPaper,
): LatexReferenceSuggestion {
  return {
    source: "papers",
    paperId: String(paper._id),
    openAlexId: paper.openAlexId ?? null,
    doi: paper.doi ?? null,
    arxivId: paper.arxivId ?? null,
    title: paper.title,
    abstract: paper.abstract ?? null,
    authors: paperAuthors(paper.authors),
    paperType: paper.type,
    year: paper.year ?? null,
    venue: paper.venue ?? null,
    publisher: paper.publisher ?? null,
    citationCount: paper.citationCount ?? null,
    isOpenAccess: Boolean(paper.openAccessStatus || paper.pdf),
    openAccessStatus: paper.openAccessStatus ?? null,
    license: paper.license ?? null,
    url: paper.url ?? paper.pdf?.url ?? null,
    matchRationale: "Match in your Papers library",
    citationKey: paper.citationKey,
    alreadyInPapers: true,
  };
}

async function searchPapers(
  query: string,
  limit: number,
): Promise<LatexReferenceSuggestion[]> {
  await connectDB();
  const escaped = query
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter((part) => part.length > 2)
    .join("|");
  const filter = escaped
    ? {
        isRetracted: { $ne: true },
        $or: [
          { title: { $regex: escaped, $options: "i" } },
          { abstract: { $regex: escaped, $options: "i" } },
          { venue: { $regex: escaped, $options: "i" } },
        ],
      }
    : { isRetracted: { $ne: true } };
  const papers = await Paper.find(filter)
    .sort({ citationCount: -1, updatedAt: -1 })
    .limit(limit)
    .lean<ILeanPaper[]>()
    .exec();
  return papers.map(localPaperSuggestion);
}

export async function searchLatexReferences(
  query: string,
  limit: number,
  project: ILatexProjectRecord["project"],
  signal?: AbortSignal,
): Promise<LatexReferenceSuggestion[]> {
  const candidateLimit = Math.min(50, Math.max(limit, limit * 2));
  const [local, global] = await Promise.all([
    searchPapers(query, candidateLimit),
    searchOpenAlex(query, { limit: candidateLimit, signal }).catch((error) => {
      console.error("OpenAlex reference search failed", error);
      return [];
    }),
  ]);
  const existingByDoi = new Map(
    local.flatMap((entry) =>
      entry.doi ? [[normalizeDoi(entry.doi) ?? entry.doi, entry]] : [],
    ),
  );
  const existingByOpenAlex = new Map(
    local.flatMap((entry) =>
      entry.openAlexId ? [[entry.openAlexId.toLowerCase(), entry]] : [],
    ),
  );
  const existingByArxiv = new Map(
    local.flatMap((entry) =>
      entry.arxivId
        ? [[entry.arxivId.toLowerCase().replace(/v\d+$/i, ""), entry]]
        : [],
    ),
  );
  const existingByTitle = new Map(
    local.map((entry) => [normalizedReferenceTitle(entry.title), entry]),
  );
  const localDeduped = new Map<string, LatexReferenceSuggestion>();
  for (const suggestion of local) {
    localDeduped.set(suggestionKey(suggestion), suggestion);
  }
  const globalDeduped = new Map<string, LatexReferenceSuggestion>();
  for (const suggestion of global) {
    const existing =
      (suggestion.doi
        ? existingByDoi.get(normalizeDoi(suggestion.doi) ?? suggestion.doi)
        : undefined) ??
      (suggestion.openAlexId
        ? existingByOpenAlex.get(suggestion.openAlexId.toLowerCase())
        : undefined) ??
      (suggestion.arxivId
        ? existingByArxiv.get(
            suggestion.arxivId.toLowerCase().replace(/v\d+$/i, ""),
          )
        : undefined) ??
      existingByTitle.get(normalizedReferenceTitle(suggestion.title));
    if (existing) continue;
    globalDeduped.set(suggestionKey(suggestion), suggestion);
  }
  const localValues = [...localDeduped.values()];
  const globalValues = [...globalDeduped.values()];
  const interleaved: LatexReferenceSuggestion[] = [];
  const count = Math.max(localValues.length, globalValues.length);
  for (let index = 0; index < count; index += 1) {
    const localSuggestion = localValues[index];
    const globalSuggestion = globalValues[index];
    if (localSuggestion) interleaved.push(localSuggestion);
    if (globalSuggestion) interleaved.push(globalSuggestion);
  }
  const citations = projectCitationIndex(project);
  return interleaved
    .filter((suggestion) => !isAlreadyCited(suggestion, citations))
    .slice(0, limit);
}

async function findOrCreatePaper(
  suggestion: LatexReferenceSuggestion,
): Promise<ILeanPaper> {
  const identifiers: Record<string, unknown>[] = [];
  if (
    suggestion.paperId &&
    mongoose.Types.ObjectId.isValid(suggestion.paperId)
  ) {
    identifiers.push({ _id: suggestion.paperId });
  }
  if (suggestion.doi) identifiers.push({ doi: normalizeDoi(suggestion.doi) });
  if (suggestion.openAlexId)
    identifiers.push({ openAlexId: suggestion.openAlexId });
  if (suggestion.arxivId) identifiers.push({ arxivId: suggestion.arxivId });
  const existing = identifiers.length
    ? await Paper.findOne({ $or: identifiers }).lean<ILeanPaper>().exec()
    : await Paper.findOne({
        title: {
          $regex: `^${suggestion.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      })
        .lean<ILeanPaper>()
        .exec();
  if (existing) return existing;
  const { paper } = await createPaperWithLinkedNote({
    title: suggestion.title,
    authors: suggestion.authors,
    abstract: suggestion.abstract ?? undefined,
    type: suggestion.paperType,
    year: suggestion.year ?? undefined,
    venue: suggestion.venue ?? undefined,
    publisher: suggestion.publisher ?? undefined,
    doi: suggestion.doi ?? undefined,
    arxivId: suggestion.arxivId ?? undefined,
    openAlexId: suggestion.openAlexId ?? undefined,
    citationCount: suggestion.citationCount ?? undefined,
    url: suggestion.url ?? undefined,
    isRetracted: false,
    openAccessStatus: suggestion.openAccessStatus ?? undefined,
    license: suggestion.license ?? undefined,
    metadataSource: suggestion.source === "openalex" ? "openalex" : "manual",
    metadataFetchedAt: new Date().toISOString(),
  });
  return paper;
}

function assertBibliographyTarget(file: ILatexFileEntry): void {
  if (file.encoding !== "utf8" || !file.path.toLowerCase().endsWith(".bib")) {
    throw new Error("Bibliography target must be a UTF-8 .bib file");
  }
}

function addBibtex(
  project: ILatexProjectRecord["project"],
  bibliographyFile: string,
  bibtex: string,
): ILatexProjectRecord["project"] {
  const file = project.entries.find(
    (entry): entry is ILatexFileEntry =>
      entry.kind === "file" && entry.path === bibliographyFile,
  );
  if (!file) {
    return {
      ...project,
      entries: [
        ...project.entries,
        {
          id: crypto.randomUUID(),
          path: bibliographyFile,
          kind: "file",
          encoding: "utf8",
          content: `${bibtex.trim()}\n`,
        },
      ],
    };
  }
  assertBibliographyTarget(file);
  const key = bibtex.match(/^@[^{]+\{\s*([^,]+)/)?.[1];
  if (
    key &&
    new RegExp(
      `@[A-Za-z]+\\s*\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`,
      "i",
    ).test(file.content)
  ) {
    return project;
  }
  return {
    ...project,
    entries: project.entries.map((entry) =>
      entry.id === file.id && entry.kind === "file"
        ? {
            ...entry,
            content: `${entry.content.trimEnd()}\n\n${bibtex.trim()}\n`,
          }
        : entry,
    ),
  };
}

export async function acceptLatexReference(
  projectId: string,
  input: AcceptLatexReferenceInput,
): Promise<{
  project: ILatexProjectRecord;
  paper: ReturnType<typeof serializePaper>;
}> {
  await connectDB();
  const current = await getLatexProject(projectId);
  const targetFile = current.project.entries.find(
    (entry): entry is ILatexFileEntry =>
      entry.kind === "file" && entry.path === input.bibliographyFile,
  );
  if (targetFile) assertBibliographyTarget(targetFile);
  const paper = await findOrCreatePaper(input.suggestion);
  const serialized = serializePaper(paper);
  await LatexProjectReference.updateOne(
    { projectId, paperId: paper._id },
    { $setOnInsert: { projectId, paperId: paper._id } },
    { upsert: true },
  ).exec();
  const projectWithBibtex = addBibtex(
    current.project,
    input.bibliographyFile,
    serialized.bibtex,
  );
  const project = await updateLatexProject(projectId, {
    baseRevision: input.baseRevision,
    project: projectWithBibtex,
    settings: { bibliographyFile: input.bibliographyFile },
  });
  return { project, paper: serialized };
}
