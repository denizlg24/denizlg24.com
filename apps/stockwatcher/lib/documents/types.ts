import { z } from "zod";
import { symbolPattern } from "@/lib/universes";

export const documentKinds = [
  "pdf",
  "text",
  "markdown",
  "csv",
  "html",
  "docx",
] as const;
export type DocumentKind = (typeof documentKinds)[number];

export const documentLimits = {
  uploadBytes: 25 * 1024 * 1024,
  textChars: 2_000_000,
  perUser: 100,
  chunkTarget: 1500,
  chunkMax: 2000,
  symbols: 12,
  tags: 12,
} as const;

export const documentExtensions =
  ".pdf,.txt,.md,.markdown,.csv,.html,.htm,.docx";

export type DocumentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: DocumentKind;
  pages: number | null;
  chunks: number;
  chars: number;
  symbols: string[];
  tags: string[];
  uploadedAt: string;
};

export type DocumentUploadResult = DocumentMeta & { warnings: string[] };

export const documentUploadResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  kind: z.enum(documentKinds),
  pages: z.number().nullable(),
  chunks: z.number(),
  chars: z.number(),
  symbols: z.array(z.string()),
  tags: z.array(z.string()),
  uploadedAt: z.string(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<DocumentUploadResult>;

export const documentIdSchema = z.uuid();

export const symbolListSchema = z
  .array(z.string().trim().toUpperCase().regex(symbolPattern))
  .max(documentLimits.symbols);

export const tagListSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(documentLimits.tags);

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
