import type { VoiceNoteMatch } from "@repo/schemas";

const MAX_SEARCH_TERMS = 8;
const SNIPPET_BEFORE = 70;
const SNIPPET_AFTER = 110;

/** Pieces are joined with a space: a cut lands mid-sentence, not between paragraphs. */
export const TRANSCRIPT_PIECE_SEPARATOR = " ";

interface SearchableVoiceNote {
  title: string;
  transcription?: {
    text?: string;
    segments?: Array<{ text: string; startSecond: number }>;
  };
}

export function searchTerms(q: string | undefined) {
  return [
    ...new Set(
      (q ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0),
    ),
  ].slice(0, MAX_SEARCH_TERMS);
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Where the earliest search term lands in the transcript, cut to a readable
 * window and mapped back to the piece it was spoken in.
 */
export function matchFor(
  voiceNote: SearchableVoiceNote,
  terms: string[],
): VoiceNoteMatch | undefined {
  if (terms.length === 0) return undefined;
  const text = voiceNote.transcription?.text ?? "";
  const lower = text.toLowerCase();
  let index = -1;
  let length = 0;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) {
      index = found;
      length = term.length;
    }
  }
  if (index >= 0) {
    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + length + SNIPPET_AFTER);
    let offset = 0;
    let startSecond: number | undefined;
    for (const segment of voiceNote.transcription?.segments ?? []) {
      const piece = segment.text.trim();
      if (!piece) continue;
      if (index < offset + piece.length) {
        startSecond = segment.startSecond;
        break;
      }
      offset += piece.length + TRANSCRIPT_PIECE_SEPARATOR.length;
    }
    return {
      field: "transcript",
      snippet: `${start > 0 ? "…" : ""}${collapse(text.slice(start, end))}${end < text.length ? "…" : ""}`,
      startSecond,
    };
  }
  const title = voiceNote.title.toLowerCase();
  if (terms.some((term) => title.includes(term))) return { field: "title" };
  return { field: "tags" };
}
