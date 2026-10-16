import type { NoteSummary } from "@repo/schemas";

interface SummarizableNote {
  _id: { toString(): string };
  title: string;
  content?: string;
  url?: string;
  status?: string;
  paperId?: unknown;
  updatedAt: Date;
}

export function summarizeNote(note: SummarizableNote): NoteSummary {
  return {
    _id: note._id.toString(),
    title: note.title,
    preview: (note.content ?? "").slice(0, 200),
    ...(note.url ? { url: note.url } : {}),
    ...(note.status ? { status: note.status } : {}),
    ...(note.paperId ? { paperId: String(note.paperId) } : {}),
    updatedAt: note.updatedAt.toISOString(),
  };
}
