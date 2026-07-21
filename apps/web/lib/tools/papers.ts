import {
  createPaperSchema,
  type PaperAuthor,
  paperHighlightSchema,
  paperMutationSchema,
  type ResolvedPaperMetadata,
} from "@repo/schemas";
import mongoose from "mongoose";
import type { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { serializePaper } from "@/lib/paper-citations";
import { remotePdfFromUrl } from "@/lib/paper-files";
import { resolvePaperMetadata } from "@/lib/paper-metadata";
import {
  createPaperWithLinkedNote,
  deleteLinkedPaperNote,
  syncPaperNote,
} from "@/lib/paper-notes";
import { preparePaperUpdate } from "@/lib/paper-route-utils";
import { deleteFileFromStorage } from "@/lib/storage-api";
import { Note } from "@/models/Note";
import { type ILeanPaper, Paper } from "@/models/Paper";
import type { ToolDefinition } from "./types";

function requireObjectId(value: unknown, entity: string): string {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    throw new Error(`Invalid ${entity} ID`);
  }
  return value;
}

function boundedNumber(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(Math.trunc(value), max))
    : fallback;
}

function stringAuthors(input: unknown): PaperAuthor[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.flatMap((value) =>
    typeof value === "string" && value.trim()
      ? [{ literal: value.trim() }]
      : [],
  );
}

function validationError(message: string, error?: z.ZodError): never {
  if (error) {
    const detail = error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${message}: ${detail}`);
  }
  throw new Error(message);
}

export const papersTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_papers",
      description:
        "List academic papers with citation metadata, reading state, PDF availability, highlight count, and linked notes.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Title, venue, DOI, arXiv id, or tag filter",
          },
          readingStatus: {
            type: "string",
            enum: ["unread", "reading", "read"],
            description: "Reading status filter",
          },
          pdfStatus: {
            type: "string",
            enum: ["present", "missing"],
            description: "PDF availability filter",
          },
          limit: { type: "number", description: "Maximum results, up to 100" },
        },
      },
    },
    isWrite: false,
    category: "papers",
    execute: async (input) => {
      await connectDB();
      const filter: Record<string, unknown> = {};
      if (["unread", "reading", "read"].includes(String(input.readingStatus))) {
        filter.readingStatus = input.readingStatus;
      }
      if (input.pdfStatus === "present") filter.pdf = { $exists: true };
      if (input.pdfStatus === "missing") filter.pdf = { $exists: false };
      if (typeof input.query === "string" && input.query.trim()) {
        const escaped = input.query
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "i");
        filter.$or = [
          { title: pattern },
          { venue: pattern },
          { doi: pattern },
          { arxivId: pattern },
          { tags: pattern },
        ];
      }
      const papers = await Paper.find(filter)
        .sort({ updatedAt: -1 })
        .limit(boundedNumber(input.limit, 20, 100))
        .lean<ILeanPaper[]>()
        .exec();
      return papers.map((paper) => ({
        _id: String(paper._id),
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        arxivId: paper.arxivId,
        citationKey: paper.citationKey,
        readingStatus: paper.readingStatus,
        pdfMissing: !paper.pdf,
        highlightCount: paper.highlights.length,
        noteId: paper.noteId ? String(paper.noteId) : undefined,
        linkedNoteIds: paper.noteIds.map(String),
      }));
    },
  },
  {
    schema: {
      name: "get_paper",
      description:
        "Get a paper by its MongoDB paper ID, including BibTeX and highlights.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Paper ID returned by list_papers",
          },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "papers",
    execute: async (input) => {
      const id = requireObjectId(input.id, "paper");
      await connectDB();
      const paper = await Paper.findById(id).lean<ILeanPaper>().exec();
      if (!paper) throw new Error("Paper not found");
      return serializePaper(paper);
    },
  },
  {
    schema: {
      name: "resolve_paper_metadata",
      description:
        "Resolve citation metadata from a DOI, arXiv identifier, or Semantic Scholar paper URL without saving it.",
      input_schema: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description: "DOI, DOI URL, arXiv id, or arXiv URL",
          },
        },
        required: ["identifier"],
      },
    },
    isWrite: false,
    category: "papers",
    execute: async (input) => {
      if (typeof input.identifier !== "string" || !input.identifier.trim()) {
        return validationError(
          "DOI, arXiv identifier, or Semantic Scholar URL is required",
        );
      }
      return resolvePaperMetadata(input.identifier);
    },
  },
  {
    schema: {
      name: "create_paper",
      description:
        "Create an academic paper and its linked knowledge-graph note. Prefer identifier for automatic metadata. A PDF is optional.",
      input_schema: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description:
              "DOI, arXiv identifier, or Semantic Scholar paper URL for metadata resolution",
          },
          title: {
            type: "string",
            description: "Title override, or required without identifier",
          },
          authors: {
            type: "array",
            items: { type: "string" },
            description: "Author display names",
          },
          abstract: { type: "string", description: "Abstract" },
          year: { type: "number", description: "Publication year" },
          venue: {
            type: "string",
            description: "Journal, conference, or venue",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Explicit tags",
          },
          readingStatus: {
            type: "string",
            enum: ["unread", "reading", "read"],
            description: "Reading state",
          },
          pdfUrl: {
            type: "string",
            description: "Direct remote PDF URL, if already available",
          },
        },
      },
    },
    isWrite: true,
    category: "papers",
    execute: async (input) => {
      await connectDB();
      const metadata: Partial<ResolvedPaperMetadata> =
        typeof input.identifier === "string" && input.identifier.trim()
          ? await resolvePaperMetadata(input.identifier)
          : {};
      const pdf =
        typeof input.pdfUrl === "string"
          ? (remotePdfFromUrl(input.pdfUrl) ??
            validationError("pdfUrl must be a direct PDF URL"))
          : undefined;
      const parsed = createPaperSchema.safeParse({
        ...metadata,
        title: input.title ?? metadata.title,
        authors: stringAuthors(input.authors) ?? metadata.authors,
        abstract: input.abstract ?? metadata.abstract,
        year: input.year ?? metadata.year,
        venue: input.venue ?? metadata.venue,
        tags: input.tags,
        readingStatus: input.readingStatus,
        pdf,
      });
      if (!parsed.success)
        return validationError("Invalid paper fields", parsed.error);
      const { paper } = await createPaperWithLinkedNote(parsed.data);
      return serializePaper(paper);
    },
  },
  {
    schema: {
      name: "update_paper",
      description:
        "Update paper citation metadata, reading state, tags, or linked note IDs.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Paper ID" },
          title: { type: "string", description: "Title" },
          authors: {
            type: "array",
            items: { type: "string" },
            description: "Replacement author display names",
          },
          abstract: { type: "string", description: "Abstract" },
          year: { type: "number", description: "Publication year" },
          venue: {
            type: "string",
            description: "Journal, conference, or venue",
          },
          doi: { type: "string", description: "DOI" },
          arxivId: { type: "string", description: "arXiv identifier" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replacement tags",
          },
          readingStatus: {
            type: "string",
            enum: ["unread", "reading", "read"],
            description: "Reading state",
          },
          noteIds: {
            type: "array",
            items: { type: "string" },
            description: "Replacement related note IDs",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "papers",
    execute: async (input) => {
      const id = requireObjectId(input.id, "paper");
      await connectDB();
      const candidate = {
        ...input,
        id: undefined,
        authors: stringAuthors(input.authors),
      };
      const parsed = paperMutationSchema.safeParse(candidate);
      if (!parsed.success)
        return validationError("Invalid paper update", parsed.error);
      const paper = await Paper.findByIdAndUpdate(
        id,
        await preparePaperUpdate(parsed.data),
        { returnDocument: "after", runValidators: true },
      )
        .lean<ILeanPaper>()
        .exec();
      if (!paper) throw new Error("Paper not found");
      await syncPaperNote(paper);
      return serializePaper(paper);
    },
  },
  {
    schema: {
      name: "add_paper_highlight",
      description: "Add a page-aware quote/highlight to a paper.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Paper ID" },
          page: { type: "number", description: "PDF page number" },
          text: { type: "string", description: "Highlighted text" },
          note: { type: "string", description: "Optional annotation" },
          color: {
            type: "string",
            enum: ["yellow", "green", "blue", "pink", "purple"],
            description: "Highlight color",
          },
        },
        required: ["id", "text"],
      },
    },
    isWrite: true,
    category: "papers",
    execute: async (input) => {
      const id = requireObjectId(input.id, "paper");
      const parsed = paperHighlightSchema.safeParse({
        id: crypto.randomUUID(),
        page: input.page,
        text: input.text,
        note: input.note,
        color: input.color ?? "yellow",
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success)
        return validationError("Invalid paper highlight", parsed.error);
      await connectDB();
      const paper = await Paper.findByIdAndUpdate(
        id,
        { $push: { highlights: parsed.data } },
        { returnDocument: "after", runValidators: true },
      )
        .lean<ILeanPaper>()
        .exec();
      if (!paper) throw new Error("Paper not found");
      return serializePaper(paper);
    },
  },
  {
    schema: {
      name: "link_note_to_paper",
      description: "Link an existing note as supporting material for a paper.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Paper ID" },
          noteId: { type: "string", description: "Existing note ID" },
        },
        required: ["id", "noteId"],
      },
    },
    isWrite: true,
    category: "papers",
    execute: async (input) => {
      const id = requireObjectId(input.id, "paper");
      const noteId = requireObjectId(input.noteId, "note");
      await connectDB();
      if (!(await Note.exists({ _id: noteId })))
        throw new Error("Note not found");
      const paper = await Paper.findByIdAndUpdate(
        id,
        { $addToSet: { noteIds: noteId } },
        { returnDocument: "after" },
      )
        .lean<ILeanPaper>()
        .exec();
      if (!paper) throw new Error("Paper not found");
      return serializePaper(paper);
    },
  },
  {
    schema: {
      name: "delete_paper",
      description:
        "Delete a paper, its graph note, highlights, and stored PDF.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Paper ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "papers",
    execute: async (input) => {
      const id = requireObjectId(input.id, "paper");
      await connectDB();
      const paper = await Paper.findByIdAndDelete(id).lean<ILeanPaper>().exec();
      if (!paper) throw new Error("Paper not found");
      try {
        await deleteLinkedPaperNote(paper);
      } catch (err) {
        console.error(`Failed to delete linked note for paper ${id}`, err);
      }
      if (paper.pdf?.storageKey) {
        try {
          await deleteFileFromStorage(paper.pdf.storageKey);
        } catch (err) {
          console.error(`Failed to delete stored PDF for paper ${id}`, err);
        }
      }
      return { success: true };
    },
  },
];
