import type { McpServer } from "@modelcontextprotocol/server";
import { voiceNoteListQuerySchema, voiceNoteUpdateSchema } from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  blobOf,
  decodeUpload,
  defineActions,
  fromResponse,
  p,
} from "../define";

const voiceNoteId = z.string().min(1).describe("Voice note id");
const byId = z.object({ voiceNoteId });

const audioFields = {
  filename: z.string().min(1),
  base64: z.string().describe("Audio bytes, ≤ 8 MB"),
  contentType: z.string().optional().describe("Audio MIME type"),
};

export function registerWebVoiceNotes(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_voice_notes",
    title: "Web: voice notes",
    description: "Recorded audio with transcripts and generated notes.",
    actions: {
      list: action({
        description:
          "Summaries without transcripts. q matches title, tags and transcript text and returns a snippet with its start second; array filters match any value",
        input: voiceNoteListQuerySchema,
        readOnly: true,
        run: (query) => api.web.get("/api/admin/voice-notes", query),
      }),
      facets: action({
        description:
          "Tags, note groups, linked events/timetable slots, sources and statuses with counts",
        input: z.object({}),
        readOnly: true,
        run: () => api.web.get("/api/admin/voice-notes/facets"),
      }),
      get: action({
        description: "One note with its transcript and timestamped segments",
        input: byId,
        readOnly: true,
        run: ({ voiceNoteId }) =>
          api.web.get(p`/api/admin/voice-notes/${voiceNoteId}`),
      }),
      context_candidates: action({
        description:
          "Calendar events and timetable slots on the recording's day, most-overlapping first",
        input: byId,
        readOnly: true,
        run: ({ voiceNoteId }) =>
          api.web.get(
            p`/api/admin/voice-notes/${voiceNoteId}/context-candidates`,
          ),
      }),
      update: action({
        description:
          'Renames, retags or relinks a note. tags replaces the whole list; context null clears the link and keeps it cleared, "auto" re-derives it from the recording time',
        input: z.object({ voiceNoteId, ...voiceNoteUpdateSchema.shape }),
        idempotent: true,
        run: ({ voiceNoteId, ...body }) =>
          api.web.patch(p`/api/admin/voice-notes/${voiceNoteId}`, body),
      }),
      delete: action({
        description: "Deletes a note and its audio",
        input: byId,
        destructive: true,
        run: ({ voiceNoteId }) =>
          api.web.delete(p`/api/admin/voice-notes/${voiceNoteId}`),
      }),
      upload: action({
        description: "Stores an audio file as a new note; transcribe queues it",
        input: z.object({
          ...audioFields,
          title: z.string().max(300).optional(),
          durationMs: z.number().int().min(0).optional(),
          recordedAt: z.iso
            .datetime({ offset: true })
            .optional()
            .describe(
              "When recording started; links the note to what it was recorded during",
            ),
          source: z.enum(["recording", "upload", "agent"]).optional(),
          noteId: z.string().optional().describe("Note to attach to"),
          waveform: z.array(z.number().min(0).max(1)).optional(),
          transcribe: z.boolean().optional(),
        }),
        run: async ({ filename, base64, contentType, ...meta }) => {
          const decoded = decodeUpload({ base64 });
          if ("error" in decoded) return decoded.error;
          const form = new FormData();
          form.set("file", blobOf(decoded.bytes, contentType), filename);
          if (meta.title) form.set("title", meta.title);
          if (meta.durationMs !== undefined)
            form.set("durationMs", String(meta.durationMs));
          if (meta.recordedAt) form.set("recordedAt", meta.recordedAt);
          if (meta.source) form.set("source", meta.source);
          if (meta.noteId) form.set("noteId", meta.noteId);
          if (meta.waveform)
            form.set("waveform", JSON.stringify(meta.waveform));
          if (meta.transcribe) form.set("transcribe", "true");
          const response = await api.web.raw("POST", "/api/admin/voice-notes", {
            raw: form,
          });
          return fromResponse(response);
        },
      }),
      transcribe: action({
        description: "Queues transcription; force retries a failed one",
        input: z.object({ voiceNoteId, force: z.boolean().optional() }),
        idempotent: true,
        run: ({ voiceNoteId, force }) =>
          api.web.post(p`/api/admin/voice-notes/${voiceNoteId}/transcribe`, {
            force,
          }),
      }),
      transcribe_direct: action({
        description: "Transcribes audio without storing it; returns the text",
        input: z.object(audioFields),
        run: async ({ filename, base64, contentType }) => {
          const decoded = decodeUpload({ base64 });
          if ("error" in decoded) return decoded.error;
          const form = new FormData();
          form.set("file", blobOf(decoded.bytes, contentType), filename);
          const response = await api.web.raw(
            "POST",
            "/api/admin/voice-notes/transcribe",
            { raw: form },
          );
          return fromResponse(response);
        },
      }),
      generate_note: action({
        description: "Writes a note from the transcript",
        input: z.object({
          voiceNoteId,
          groupIds: z.array(z.string()).optional(),
          model: z.string().optional(),
          instructions: z.string().optional(),
        }),
        run: ({ voiceNoteId, ...body }) =>
          api.web.post(
            p`/api/admin/voice-notes/${voiceNoteId}/generate-note`,
            body,
          ),
      }),
    },
  });
}
