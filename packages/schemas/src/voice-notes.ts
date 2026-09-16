import { z } from "zod";

export const voiceNoteTranscriptionStatusSchema = z.enum([
  "untranscribed",
  "queued",
  "transcribing",
  "transcribed",
  "failed",
]);
export type VoiceNoteTranscriptionStatus = z.infer<
  typeof voiceNoteTranscriptionStatusSchema
>;

export const voiceNoteSourceSchema = z.enum(["recording", "upload", "agent"]);
export type VoiceNoteSource = z.infer<typeof voiceNoteSourceSchema>;

export const voiceNoteTranscriptSegmentSchema = z.object({
  text: z.string(),
  startSecond: z.number().nonnegative(),
  endSecond: z.number().nonnegative(),
});
export type VoiceNoteTranscriptSegment = z.infer<
  typeof voiceNoteTranscriptSegmentSchema
>;

export const voiceNoteTitleSourceSchema = z.enum([
  "placeholder",
  "generated",
  "manual",
]);
export type VoiceNoteTitleSource = z.infer<typeof voiceNoteTitleSourceSchema>;

export const voiceNoteContextKindSchema = z.enum([
  "calendar-event",
  "timetable-entry",
]);
export type VoiceNoteContextKind = z.infer<typeof voiceNoteContextKindSchema>;

/**
 * `manual` is sticky: re-derivation never replaces it, and a manual source
 * with no context is the owner having cleared the link on purpose.
 */
export const voiceNoteContextSourceSchema = z.enum(["auto", "manual"]);
export type VoiceNoteContextSource = z.infer<
  typeof voiceNoteContextSourceSchema
>;

/** The calendar event or timetable slot a recording was made during. */
export const voiceNoteContextSchema = z.object({
  kind: voiceNoteContextKindSchema,
  id: z.string(),
  title: z.string(),
  /** This occurrence's bounds; a timetable slot is dated to the recording day. */
  start: z.string().optional(),
  end: z.string().optional(),
  place: z.string().optional(),
  color: z.string().optional(),
});
export type VoiceNoteContext = z.infer<typeof voiceNoteContextSchema>;

export const voiceNoteGroupRefSchema = z.object({
  _id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});
export type VoiceNoteGroupRef = z.infer<typeof voiceNoteGroupRefSchema>;

export const voiceNoteTranscriptionProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const voiceNoteMatchSchema = z.object({
  field: z.enum(["title", "tags", "transcript"]),
  snippet: z.string().optional(),
  /** Start of the transcript segment the snippet came from. */
  startSecond: z.number().nonnegative().optional(),
});
export type VoiceNoteMatch = z.infer<typeof voiceNoteMatchSchema>;

const transcriptionStateShape = {
  status: voiceNoteTranscriptionStatusSchema,
  language: z.string().optional(),
  model: z.string().optional(),
  progress: voiceNoteTranscriptionProgressSchema.optional(),
  requestedAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
};

/** What a list returns: everything but the transcript body. */
export const voiceNoteSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  titleSource: voiceNoteTitleSourceSchema,
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  /** Downsampled for lists; the full envelope comes with the note itself. */
  waveform: z.array(z.number().min(0).max(1)),
  source: voiceNoteSourceSchema,
  noteIds: z.array(z.string()),
  tags: z.array(z.string()),
  groups: z.array(voiceNoteGroupRefSchema),
  context: voiceNoteContextSchema.optional(),
  contextSource: voiceNoteContextSourceSchema.optional(),
  /** When the recording started; the upload time for anything without one. */
  recordedAt: z.string(),
  transcription: z.object(transcriptionStateShape),
  transcriptPreview: z.string().optional(),
  match: voiceNoteMatchSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IVoiceNoteSummary = z.infer<typeof voiceNoteSummarySchema>;

export const voiceNoteSchema = voiceNoteSummarySchema.extend({
  filename: z.string(),
  linkedNotes: z.array(z.object({ _id: z.string(), title: z.string() })),
  transcription: z.object({
    ...transcriptionStateShape,
    text: z.string().optional(),
    segments: z.array(voiceNoteTranscriptSegmentSchema).optional(),
  }),
});
export type IVoiceNote = z.infer<typeof voiceNoteSchema>;

export const voiceNoteSortSchema = z.enum([
  "newest",
  "oldest",
  "longest",
  "shortest",
]);
export type VoiceNoteSort = z.infer<typeof voiceNoteSortSchema>;

/** Array filters match any of their values. */
export const voiceNoteListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.array(voiceNoteTranscriptionStatusSchema).optional(),
  source: z.array(voiceNoteSourceSchema).optional(),
  tag: z.array(z.string().trim().min(1)).optional(),
  groupId: z.array(z.string().min(1)).optional(),
  contextId: z.array(z.string().min(1)).optional(),
  context: z.enum(["any", "none"]).optional(),
  linked: z.boolean().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: voiceNoteSortSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export type VoiceNoteListQuery = z.infer<typeof voiceNoteListQuerySchema>;

export const voiceNotesResponseSchema = z.object({
  voiceNotes: z.array(voiceNoteSummarySchema),
  total: z.number().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
});
export type VoiceNotesResponse = z.infer<typeof voiceNotesResponseSchema>;

export const voiceNoteFacetsResponseSchema = z.object({
  tags: z.array(z.object({ name: z.string(), count: z.number() })),
  groups: z.array(voiceNoteGroupRefSchema.extend({ count: z.number() })),
  contexts: z.array(
    z.object({
      kind: voiceNoteContextKindSchema,
      id: z.string(),
      title: z.string(),
      count: z.number(),
    }),
  ),
  sources: z.array(
    z.object({ source: voiceNoteSourceSchema, count: z.number() }),
  ),
  statuses: z.array(
    z.object({
      status: voiceNoteTranscriptionStatusSchema,
      count: z.number(),
    }),
  ),
});
export type VoiceNoteFacetsResponse = z.infer<
  typeof voiceNoteFacetsResponseSchema
>;

export const voiceNoteContextCandidateSchema = voiceNoteContextSchema.extend({
  start: z.string(),
  end: z.string(),
  /** How much of the recording falls inside it; 0 when they do not overlap. */
  overlapMs: z.number().nonnegative(),
});
export type VoiceNoteContextCandidate = z.infer<
  typeof voiceNoteContextCandidateSchema
>;

export const voiceNoteContextCandidatesResponseSchema = z.object({
  events: z.array(voiceNoteContextCandidateSchema),
  timetableEntries: z.array(voiceNoteContextCandidateSchema),
});
export type VoiceNoteContextCandidatesResponse = z.infer<
  typeof voiceNoteContextCandidatesResponseSchema
>;

/** Ephemeral transcription: audio in, text out, nothing stored. */
export const voiceTranscriptionResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  model: z.string().optional(),
  durationSeconds: z.number().nonnegative().optional(),
});
export type VoiceTranscriptionResponse = z.infer<
  typeof voiceTranscriptionResponseSchema
>;

export const VOICE_NOTE_MAX_TAGS = 20;

/**
 * Stored recordings, not what one transcription request accepts: long audio is
 * split before it reaches the model. Roughly 11 hours at the ~50 kbps the
 * desktop web view actually records at.
 */
export const VOICE_NOTE_MAX_BYTES = 256 * 1024 * 1024;

export const voiceNoteContextRefSchema = z.object({
  kind: voiceNoteContextKindSchema,
  id: z.string().min(1),
});

/**
 * `context: null` clears the link and keeps it cleared; `"auto"` hands it back
 * to derivation from the recording time.
 */
export const voiceNoteUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(VOICE_NOTE_MAX_TAGS)
      .optional(),
    context: z
      .union([voiceNoteContextRefSchema, z.null(), z.literal("auto")])
      .optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.tags !== undefined ||
      value.context !== undefined,
    { message: "Nothing to update" },
  );
export type VoiceNoteUpdateInput = z.infer<typeof voiceNoteUpdateSchema>;
