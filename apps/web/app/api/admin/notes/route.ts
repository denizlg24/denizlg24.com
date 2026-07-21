import type { CreatePaperInput } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import { resolveIncomingCategorization } from "@/lib/apply-note-categorization";
import { fetchUrlMetadata, type UrlMetadata } from "@/lib/fetch-url-metadata";
import { connectDB } from "@/lib/mongodb";
import {
  pruneGroupIds,
  serializeEdge,
  serializeGroup,
  serializeNote,
} from "@/lib/note-route-utils";
import {
  normalizeArxivId,
  normalizeDoi,
  serializePaper,
} from "@/lib/paper-citations";
import { remotePdfFromUrl } from "@/lib/paper-files";
import {
  isAcademicPaperProviderUrl,
  isSemanticScholarPaperUrl,
  resolvePaperMetadata,
  resolvePaperMetadataByTitle,
} from "@/lib/paper-metadata";
import { createPaperWithLinkedNote, ensurePaperNote } from "@/lib/paper-notes";
import { requireAdmin } from "@/lib/require-admin";
import {
  type ILeanKnowledgeSemanticRun,
  KnowledgeSemanticRun,
} from "@/models/KnowledgeSemanticRun";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteEdge, NoteEdge } from "@/models/NoteEdge";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";
import { type ILeanPaper, Paper } from "@/models/Paper";

function pickString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();

    const [notes, groups, edges] = await Promise.all([
      Note.find().sort({ createdAt: -1 }).lean<ILeanNote[]>().exec(),
      NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
      NoteEdge.find().lean<ILeanNoteEdge[]>().exec(),
    ]);
    const [semanticPending, semanticStale, suggestionsPending, latestRun] =
      await Promise.all([
        Note.countDocuments({ semanticStatus: "pending" }),
        Note.countDocuments({ semanticStatus: "stale" }),
        KnowledgeSemanticSuggestion.countDocuments({ status: "pending" }),
        KnowledgeSemanticRun.findOne()
          .sort({ startedAt: -1 })
          .lean<ILeanKnowledgeSemanticRun>()
          .exec(),
      ]);

    return NextResponse.json(
      {
        notes: notes.map(serializeNote),
        groups: groups.map(serializeGroup),
        edges: edges.map(serializeEdge),
        stats: {
          total: notes.length,
          groups: groups.length,
          edges: edges.length,
          semanticPending,
          semanticStale,
          suggestionsPending,
        },
        semantic: latestRun
          ? {
              latestRun: {
                _id: String(latestRun._id),
                status: latestRun.status,
                model: latestRun.model,
                completedAt: latestRun.completedAt,
                edgeCount: latestRun.edgeCount,
                clusterCount: latestRun.clusterCount,
              },
            }
          : undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const url = pickString(body.url);
    const skipCategorize =
      body.useLegacyLlmCategorization !== true || body.skipCategorize === true;
    const skipMetadataFetch = body.skipMetadataFetch === true;

    await connectDB();

    if (url) {
      const existing = await Note.findOne({ url }).lean<ILeanNote>().exec();
      if (existing) {
        return NextResponse.json(
          {
            error: "Note already exists",
            note: serializeNote(existing),
          },
          { status: 409 },
        );
      }
    }

    const providedMeta =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : null;

    let metadata: UrlMetadata | null = null;
    if (url) {
      if (providedMeta) {
        metadata = {
          url: pickString(providedMeta.url) ?? url,
          title: pickString(providedMeta.title) ?? url,
          description: pickString(providedMeta.description),
          favicon: pickString(providedMeta.favicon),
          image: pickString(providedMeta.image),
          siteName: pickString(providedMeta.siteName),
          doi: pickString(providedMeta.doi),
          arxivId: pickString(providedMeta.arxivId),
          pdfUrl: pickString(providedMeta.pdfUrl),
        };
      } else if (!skipMetadataFetch) {
        metadata = await fetchUrlMetadata(url);
      } else {
        metadata = { url, title: url };
      }
    }

    const manualTitle = pickString(body.title);
    const title = manualTitle ?? metadata?.title;
    if (!title) {
      return NextResponse.json(
        { error: "title required when url is blank" },
        { status: 400 },
      );
    }

    const manualDescription =
      typeof body.description === "string" ? body.description : undefined;
    const manualClass = pickString(body.class);
    const manualContent = typeof body.content === "string" ? body.content : "";
    const manualStatus =
      body.status === "archived" || body.status === "open"
        ? body.status
        : undefined;
    const rawManualTags: unknown[] = Array.isArray(body.tags) ? body.tags : [];
    const manualTags = rawManualTags.filter(
      (tag): tag is string => typeof tag === "string",
    );
    const rawManualGroupIds: unknown[] = Array.isArray(body.groupIds)
      ? body.groupIds
      : [];
    const manualGroupIds = rawManualGroupIds.filter(
      (groupId: unknown): groupId is string =>
        typeof groupId === "string" && mongoose.Types.ObjectId.isValid(groupId),
    );

    let tags: string[] = [...new Set(manualTags)];
    let prunedGroupIds = await pruneGroupIds(manualGroupIds);
    let status: "open" | "archived" = manualStatus ?? "open";

    if (url && !skipCategorize) {
      const resolved = await resolveIncomingCategorization({
        input: {
          title,
          url: metadata?.url,
          description: manualDescription ?? metadata?.description,
          siteName: metadata?.siteName,
          content: manualContent,
        },
        manualTags,
        manualGroupIds,
      });

      tags = resolved.tags;
      prunedGroupIds = resolved.groupIds;
      status = manualStatus ?? status;
    }

    const publishedDate =
      typeof body.publishedDate === "string"
        ? new Date(body.publishedDate)
        : undefined;

    const doi = url
      ? normalizeDoi(url) || normalizeDoi(metadata?.doi ?? "")
      : undefined;
    const arxivId = url
      ? normalizeArxivId(url) || normalizeArxivId(metadata?.arxivId ?? "")
      : undefined;
    const detectedPdf = url
      ? remotePdfFromUrl(metadata?.pdfUrl ?? url)
      : undefined;
    const semanticScholarUrl = url && isSemanticScholarPaperUrl(url);
    const academicProviderUrl = url && isAcademicPaperProviderUrl(url);
    if (url && (doi || arxivId || detectedPdf || academicProviderUrl)) {
      const identityFilters = [
        ...(doi ? [{ doi }] : []),
        ...(arxivId ? [{ arxivId }] : []),
      ];
      const existingPaper = identityFilters.length
        ? await Paper.findOne({ $or: identityFilters })
            .lean<ILeanPaper>()
            .exec()
        : null;
      if (existingPaper) {
        const linkedNote = await ensurePaperNote(existingPaper);
        const existingGroups = await NoteGroup.find()
          .sort({ name: 1 })
          .lean<ILeanNoteGroup[]>()
          .exec();
        return NextResponse.json(
          {
            note: serializeNote(linkedNote),
            paper: serializePaper(existingPaper),
            groups: existingGroups.map(serializeGroup),
            edges: [],
          },
          { status: 200 },
        );
      }

      let academicMetadata: Awaited<
        ReturnType<typeof resolvePaperMetadata>
      > | null = null;
      const academicIdentifier =
        doi || arxivId || (semanticScholarUrl ? url : undefined);
      if (academicIdentifier) {
        try {
          academicMetadata = await resolvePaperMetadata(academicIdentifier);
        } catch (error) {
          console.error(
            "Paper metadata lookup failed during note import:",
            error,
          );
        }
      }
      if (!academicMetadata && academicProviderUrl) {
        try {
          academicMetadata = await resolvePaperMetadataByTitle(title);
        } catch (error) {
          console.error("Paper title lookup failed during note import:", error);
        }
      }

      const paperInput: CreatePaperInput = {
        ...(academicMetadata ?? {
          title,
          authors: [],
          type: arxivId ? "preprint" : "article",
          metadataSource: "manual",
        }),
        title: manualTitle ?? academicMetadata?.title ?? title,
        abstract:
          manualContent.trim() ||
          academicMetadata?.abstract ||
          manualDescription ||
          metadata?.description,
        doi: academicMetadata?.doi ?? doi,
        arxivId: academicMetadata?.arxivId ?? arxivId,
        url: academicMetadata?.url ?? metadata?.url ?? url,
        pdf: detectedPdf ?? academicMetadata?.pdf,
        tags,
        readingStatus: status === "archived" ? "read" : "unread",
      };
      const created = await createPaperWithLinkedNote(paperInput, {
        note: {
          content: manualContent || academicMetadata?.abstract || "",
          description:
            manualDescription ??
            academicMetadata?.abstract ??
            metadata?.description,
          groupIds: prunedGroupIds,
          manualGroupIds: prunedGroupIds,
          publishedDate:
            publishedDate && !Number.isNaN(publishedDate.getTime())
              ? publishedDate
              : undefined,
          status,
          url,
        },
      });
      const paperGroups = await NoteGroup.find()
        .sort({ name: 1 })
        .lean<ILeanNoteGroup[]>()
        .exec();
      await observeDomainRecordSafely("note", created.note);
      return NextResponse.json(
        {
          note: serializeNote(created.note),
          paper: serializePaper(created.paper),
          groups: paperGroups.map(serializeGroup),
          edges: [],
        },
        { status: 201 },
      );
    }

    const note = await Note.create({
      title,
      content: manualContent,
      url: metadata?.url,
      description: manualDescription ?? metadata?.description,
      siteName: metadata?.siteName,
      favicon: metadata?.favicon,
      image: metadata?.image,
      publishedDate:
        publishedDate && !Number.isNaN(publishedDate.getTime())
          ? publishedDate
          : undefined,
      tags,
      groupIds: prunedGroupIds,
      manualGroupIds: prunedGroupIds,
      status,
      ...(manualClass ? { class: manualClass } : {}),
      semanticStatus: "pending",
    });

    const [groups, edges] = await Promise.all([
      NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
      Promise.resolve([] as ILeanNoteEdge[]),
    ]);

    const createdNote = await Note.findById(note._id).lean<ILeanNote>().exec();
    if (!createdNote) {
      throw new Error("Created note could not be reloaded");
    }
    await observeDomainRecordSafely("note", createdNote);

    return NextResponse.json(
      {
        note: serializeNote(createdNote),
        groups: groups.map(serializeGroup),
        edges: edges.map(serializeEdge),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to create note" },
      { status: 500 },
    );
  }
}
