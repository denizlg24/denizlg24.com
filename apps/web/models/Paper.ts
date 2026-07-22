import type {
  PaperAuthor,
  PaperHighlightColor,
  PaperReadingStatus,
  PaperType,
} from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";

export interface IPaperHighlight {
  id: string;
  page?: number;
  text: string;
  note?: string;
  color: PaperHighlightColor;
  createdAt: Date;
}

export interface IPaperFile {
  url: string;
  storageKey?: string;
  fileName: string;
  mimeType: "application/pdf";
  sizeBytes: number;
}

export interface IPaper extends Document {
  title: string;
  authors: PaperAuthor[];
  abstract?: string;
  type: PaperType;
  readingStatus: PaperReadingStatus;
  year?: number;
  publishedDate?: Date;
  venue?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  language?: string;
  isbn: string[];
  issn: string[];
  doi?: string;
  arxivId?: string;
  arxivCategory?: string;
  openAlexId?: string;
  isRetracted?: boolean;
  openAccessStatus?: string;
  license?: string;
  citationKey: string;
  citationCount?: number;
  url?: string;
  pdf?: IPaperFile;
  noteId?: mongoose.Types.ObjectId;
  tags: string[];
  noteIds: mongoose.Types.ObjectId[];
  highlights: IPaperHighlight[];
  metadataSource:
    | "manual"
    | "crossref"
    | "arxiv"
    | "semantic_scholar"
    | "openalex";
  metadataFetchedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanPaper
  extends Omit<IPaper, keyof Document | "noteId" | "noteIds"> {
  _id: mongoose.Types.ObjectId;
  noteId?: mongoose.Types.ObjectId;
  noteIds: mongoose.Types.ObjectId[];
}

const AuthorSchema = new Schema<PaperAuthor>(
  {
    family: { type: String, trim: true, maxlength: 200 },
    given: { type: String, trim: true, maxlength: 200 },
    literal: { type: String, trim: true, maxlength: 300 },
    orcid: { type: String, trim: true, maxlength: 100 },
  },
  { _id: false },
);

const HighlightSchema = new Schema<IPaperHighlight>(
  {
    id: { type: String, required: true, maxlength: 100 },
    page: { type: Number, min: 1, max: 100_000 },
    text: { type: String, required: true, maxlength: 20_000 },
    note: { type: String, maxlength: 20_000 },
    color: {
      type: String,
      enum: ["yellow", "green", "blue", "pink", "purple"],
      default: "yellow",
    },
    createdAt: { type: Date, required: true },
  },
  { _id: false },
);

const PaperFileSchema = new Schema<IPaperFile>(
  {
    url: { type: String, required: true, maxlength: 2_000 },
    storageKey: { type: String, maxlength: 1_000 },
    fileName: { type: String, required: true, maxlength: 500 },
    mimeType: {
      type: String,
      enum: ["application/pdf"],
      required: true,
    },
    sizeBytes: { type: Number, required: true, min: 0, max: 50 * 1024 * 1024 },
  },
  { _id: false },
);

const PaperSchema = new Schema<IPaper>(
  {
    title: { type: String, required: true, trim: true, maxlength: 1_000 },
    authors: { type: [AuthorSchema], default: [] },
    abstract: { type: String, maxlength: 100_000 },
    type: {
      type: String,
      enum: [
        "article",
        "conference",
        "preprint",
        "thesis",
        "book",
        "chapter",
        "report",
        "dataset",
        "other",
      ],
      default: "article",
      index: true,
    },
    readingStatus: {
      type: String,
      enum: ["unread", "reading", "read"],
      default: "unread",
      index: true,
    },
    year: { type: Number, min: 1000, max: 3000, index: true },
    publishedDate: { type: Date },
    venue: { type: String, trim: true, maxlength: 1_000 },
    publisher: { type: String, trim: true, maxlength: 1_000 },
    volume: { type: String, trim: true, maxlength: 100 },
    issue: { type: String, trim: true, maxlength: 100 },
    pages: { type: String, trim: true, maxlength: 100 },
    edition: { type: String, trim: true, maxlength: 100 },
    language: { type: String, trim: true, maxlength: 100 },
    isbn: { type: [String], default: [] },
    issn: { type: [String], default: [] },
    doi: { type: String, trim: true, lowercase: true },
    arxivId: { type: String, trim: true, lowercase: true },
    arxivCategory: { type: String, trim: true, maxlength: 100 },
    openAlexId: { type: String, trim: true, maxlength: 100 },
    isRetracted: { type: Boolean, default: false },
    openAccessStatus: { type: String, trim: true, maxlength: 100 },
    license: { type: String, trim: true, maxlength: 200 },
    citationKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    citationCount: { type: Number, min: 0 },
    url: { type: String, trim: true, maxlength: 2_000 },
    pdf: { type: PaperFileSchema },
    noteId: {
      type: Schema.Types.ObjectId,
      ref: "KnowledgeNote",
      index: true,
      unique: true,
      sparse: true,
    },
    tags: { type: [String], default: [] },
    noteIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "KnowledgeNote" }],
      default: [],
      index: true,
    },
    highlights: { type: [HighlightSchema], default: [] },
    metadataSource: {
      type: String,
      enum: ["manual", "crossref", "arxiv", "semantic_scholar", "openalex"],
      default: "manual",
    },
    metadataFetchedAt: { type: Date },
  },
  { collection: "papers", timestamps: true },
);

PaperSchema.index({ doi: 1 }, { unique: true, sparse: true });
PaperSchema.index({ arxivId: 1 }, { unique: true, sparse: true });
PaperSchema.index({ openAlexId: 1 }, { unique: true, sparse: true });
PaperSchema.index({ citationKey: 1 }, { unique: true });
PaperSchema.index({ updatedAt: -1 });
PaperSchema.index({
  title: "text",
  abstract: "text",
  venue: "text",
  tags: "text",
});

export const Paper: mongoose.Model<IPaper> =
  (mongoose.models.Paper as mongoose.Model<IPaper> | undefined) ||
  mongoose.model<IPaper>("Paper", PaperSchema);
