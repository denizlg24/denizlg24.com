import type { CreatePaperInput } from "@repo/schemas";
import mongoose from "mongoose";
import { fetchUrlMetadata } from "@/lib/fetch-url-metadata";
import { connectDB } from "@/lib/mongodb";
import { normalizeArxivId, normalizeDoi } from "@/lib/paper-citations";
import { remotePdfFromUrl } from "@/lib/paper-files";
import {
  isAcademicPaperProviderUrl,
  isSemanticScholarPaperUrl,
  resolvePaperMetadata,
  resolvePaperMetadataByTitle,
} from "@/lib/paper-metadata";
import { createPaperWithLinkedNote, ensurePaperNote } from "@/lib/paper-notes";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanPaper, Paper } from "@/models/Paper";

interface MigrationOptions {
  apply: boolean;
  limit: number;
  skipMetadata: boolean;
}

interface LegacyPaperIdentity {
  arxivId?: string;
  doi?: string;
  reason: "class" | "doi" | "arxiv" | "provider";
}

function valueAfterEquals(argument: string): string | undefined {
  return argument.includes("=")
    ? argument.slice(argument.indexOf("=") + 1)
    : undefined;
}

export function parsePaperMigrationOptions(args: string[]): MigrationOptions {
  const options: MigrationOptions = {
    apply: false,
    limit: Number.POSITIVE_INFINITY,
    skipMetadata: false,
  };
  for (const argument of args) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--skip-metadata") options.skipMetadata = true;
    else if (argument.startsWith("--limit=")) {
      options.limit = Number(valueAfterEquals(argument));
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Paper-note migration

Usage:
  bun run papers:migrate
  bun run papers:migrate --apply [--limit=N] [--skip-metadata]

Options:
  --apply          Perform writes (default is dry-run)
  --limit=N        Process at most N legacy notes
  --skip-metadata  Do not call Crossref/arXiv during apply

The migration is idempotent. Existing paper links are skipped, note folders and
semantic fields are preserved, and papers that lack a graph note are backfilled.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (
    options.limit !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
}

function doiFromText(value: string): string | undefined {
  const match = value.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0];
  return match ? normalizeDoi(match.replace(/[.,;:)]+$/, "")) : undefined;
}

function arxivFromText(value: string): string | undefined {
  const direct = normalizeArxivId(value);
  if (direct) return direct;
  const match = value.match(
    /^(?:arxiv:\s*)?((?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)\b/im,
  )?.[1];
  return match ? normalizeArxivId(match) : undefined;
}

export function detectLegacyPaperNote(
  note: Pick<ILeanNote, "class" | "content" | "title" | "url">,
): LegacyPaperIdentity | undefined {
  const combined = [note.url, note.title, note.content]
    .filter(Boolean)
    .join("\n");
  const doi =
    (note.url ? normalizeDoi(note.url) : undefined) || doiFromText(combined);
  if (doi) return { doi, reason: "doi" };
  const arxivId =
    (note.url ? normalizeArxivId(note.url) : undefined) ||
    arxivFromText(combined);
  if (arxivId) return { arxivId, reason: "arxiv" };
  if (note.class?.trim().toLowerCase() === "paper") return { reason: "class" };
  if (note.url && isAcademicPaperProviderUrl(note.url)) {
    return { reason: "provider" };
  }
  return undefined;
}

function manualPaperInput(
  note: ILeanNote,
  identity: LegacyPaperIdentity,
): CreatePaperInput {
  return {
    title: note.title,
    authors: [],
    abstract: note.description || note.content || undefined,
    type: identity.arxivId ? "preprint" : "article",
    readingStatus: note.status === "archived" ? "read" : "unread",
    year: note.publishedDate?.getUTCFullYear(),
    publishedDate: note.publishedDate?.toISOString(),
    doi: identity.doi,
    arxivId: identity.arxivId,
    url: note.url,
    pdf: note.url ? remotePdfFromUrl(note.url) : undefined,
    tags: note.tags,
    metadataSource: "manual",
  };
}

async function inputForNote(
  note: ILeanNote,
  identity: LegacyPaperIdentity,
  skipMetadata: boolean,
): Promise<CreatePaperInput> {
  let resolvedIdentity = identity;
  let pagePdf: CreatePaperInput["pdf"];
  if (
    !skipMetadata &&
    note.url &&
    !identity.doi &&
    !identity.arxivId &&
    !isSemanticScholarPaperUrl(note.url)
  ) {
    try {
      const pageMetadata = await fetchUrlMetadata(note.url);
      resolvedIdentity = {
        reason: identity.reason,
        doi: pageMetadata.doi ? normalizeDoi(pageMetadata.doi) : undefined,
        arxivId: pageMetadata.arxivId
          ? normalizeArxivId(pageMetadata.arxivId)
          : undefined,
      };
      pagePdf = pageMetadata.pdfUrl
        ? remotePdfFromUrl(pageMetadata.pdfUrl)
        : undefined;
    } catch (error) {
      console.error(
        `[papers:migrate] publisher metadata failed for note ${String(note._id)}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const manual = manualPaperInput(note, resolvedIdentity);
  const identifier =
    resolvedIdentity.doi ||
    resolvedIdentity.arxivId ||
    (note.url && isSemanticScholarPaperUrl(note.url) ? note.url : undefined);
  if (skipMetadata) return manual;

  let metadata: Awaited<ReturnType<typeof resolvePaperMetadata>> | undefined;
  if (identifier) {
    try {
      metadata = await resolvePaperMetadata(identifier);
    } catch (error) {
      console.error(
        `[papers:migrate] identifier metadata failed for note ${String(note._id)}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (!metadata) {
    try {
      metadata = await resolvePaperMetadataByTitle(note.title);
    } catch (error) {
      console.error(
        `[papers:migrate] title metadata failed for note ${String(note._id)}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (!metadata) {
    console.error(
      `[papers:migrate] using manual metadata for note ${String(note._id)}`,
    );
    return manual;
  }
  return {
    ...manual,
    ...metadata,
    title: note.title || metadata.title,
    abstract: metadata.abstract || manual.abstract,
    tags: note.tags,
    readingStatus: manual.readingStatus,
    pdf: manual.pdf ?? metadata.pdf ?? pagePdf,
  };
}

async function migrate(options: MigrationOptions) {
  await connectDB();
  const [unlinkedPapers, candidates] = await Promise.all([
    Paper.find({ noteId: { $exists: false } })
      .sort({ _id: 1 })
      .lean<ILeanPaper[]>(),
    Note.find({
      paperId: { $exists: false },
      $or: [
        { class: { $regex: /^paper$/i } },
        { url: { $regex: /(?:doi\.org|arxiv\.org)/i } },
        {
          url: {
            $regex:
              /(?:ieeexplore\.ieee\.org|semanticscholar\.org|dl\.acm\.org|link\.springer\.com|nature\.com|sciencedirect\.com|onlinelibrary\.wiley\.com|jstor\.org|pubmed\.ncbi\.nlm\.nih\.gov|biorxiv\.org|medrxiv\.org|openreview\.net|papers\.ssrn\.com)/i,
          },
        },
        { title: { $regex: /(?:\b10\.\d{4,9}\/|\barxiv:\s*)/i } },
        {
          content: {
            $regex: /(?:\b10\.\d{4,9}\/|\bdoi:\s*10\.|\barxiv:\s*)/i,
          },
        },
      ],
    })
      .sort({ _id: 1 })
      .limit(Number.isFinite(options.limit) ? options.limit : 0)
      .lean<ILeanNote[]>(),
  ]);
  const detected = candidates.flatMap((note) => {
    const identity = detectLegacyPaperNote(note);
    return identity ? [{ note, identity }] : [];
  });

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        unlinkedPapers: unlinkedPapers.length,
        candidateNotes: detected.length,
        reasons: detected.reduce<Record<string, number>>((totals, item) => {
          totals[item.identity.reason] =
            (totals[item.identity.reason] ?? 0) + 1;
          return totals;
        }, {}),
        sample: detected.slice(0, 20).map(({ note, identity }) => ({
          noteId: String(note._id),
          title: note.title,
          ...identity,
          hasPdfUrl: Boolean(note.url && remotePdfFromUrl(note.url)),
        })),
      },
      null,
      2,
    ),
  );
  if (!options.apply) {
    console.log("Dry-run only. Add --apply to perform writes.");
    return;
  }

  const totals = {
    paperNotesBackfilled: 0,
    notesMigrated: 0,
    existingPapersLinked: 0,
    conflicts: 0,
    failed: 0,
  };

  for (const { note, identity } of detected) {
    try {
      const filters = [
        ...(identity.doi ? [{ doi: identity.doi }] : []),
        ...(identity.arxivId ? [{ arxivId: identity.arxivId }] : []),
      ];
      const existing = filters.length
        ? await Paper.findOne({ $or: filters }).lean<ILeanPaper>().exec()
        : null;
      if (existing) {
        const existingNoteId = existing.noteId
          ? String(existing.noteId)
          : undefined;
        if (existingNoteId === String(note._id)) {
          await Note.updateOne(
            { _id: note._id },
            {
              $set: {
                paperId: existing._id,
                class: "paper",
                semanticStatus: "stale",
              },
            },
          );
          totals.existingPapersLinked += 1;
          continue;
        }
        const alreadyLinked = await Note.exists({ paperId: existing._id });
        if (existing.noteId || alreadyLinked) {
          totals.conflicts += 1;
          console.error(
            `[papers:migrate] note ${String(note._id)} conflicts with linked paper ${String(existing._id)}`,
          );
          continue;
        }
        await Note.updateOne(
          { _id: note._id, paperId: { $exists: false } },
          {
            $set: {
              paperId: existing._id,
              class: "paper",
              semanticStatus: "stale",
            },
          },
        );
        await Paper.updateOne(
          { _id: existing._id, noteId: { $exists: false } },
          { $set: { noteId: note._id } },
        );
        totals.existingPapersLinked += 1;
        continue;
      }

      await createPaperWithLinkedNote(
        await inputForNote(note, identity, options.skipMetadata),
        { existingNoteId: String(note._id) },
      );
      totals.notesMigrated += 1;
    } catch (error) {
      totals.failed += 1;
      console.error(`[papers:migrate] note ${String(note._id)}:`, error);
    }
  }

  // Backfill only after legacy-note promotion so an existing paper can reuse
  // its original note instead of receiving a duplicate graph placeholder.
  for (const paper of unlinkedPapers) {
    try {
      const current = await Paper.findById(paper._id).lean<ILeanPaper>().exec();
      if (!current || current.noteId) continue;
      await ensurePaperNote(current);
      totals.paperNotesBackfilled += 1;
    } catch (error) {
      totals.failed += 1;
      console.error(`[papers:migrate] paper ${String(paper._id)}:`, error);
    }
  }

  console.log(JSON.stringify(totals, null, 2));
  if (totals.failed > 0 || totals.conflicts > 0) process.exitCode = 2;
}

if (import.meta.main) {
  try {
    await migrate(parsePaperMigrationOptions(process.argv.slice(2)));
  } finally {
    await mongoose.disconnect();
  }
}
