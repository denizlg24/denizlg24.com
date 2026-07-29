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

export const voiceNoteSchema = z.object({
  _id: z.string(),
  title: z.string(),
  titleSource: voiceNoteTitleSourceSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  waveform: z.array(z.number().min(0).max(1)),
  source: z.enum(["recording", "upload", "agent"]),
  noteIds: z.array(z.string()),
  transcription: z.object({
    status: voiceNoteTranscriptionStatusSchema,
    text: z.string().optional(),
    language: z.string().optional(),
    model: z.string().optional(),
    segments: z.array(voiceNoteTranscriptSegmentSchema).optional(),
    requestedAt: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IVoiceNote = z.infer<typeof voiceNoteSchema>;

export const voiceNotesResponseSchema = z.object({
  voiceNotes: z.array(voiceNoteSchema),
  total: z.number().nonnegative(),
});
export type VoiceNotesResponse = z.infer<typeof voiceNotesResponseSchema>;
