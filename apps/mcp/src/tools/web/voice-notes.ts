import type { McpServer } from "@modelcontextprotocol/server";
import {
  voiceNoteTitleSchema,
  voiceNoteTranscriptionStatusSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  blobOf,
  decodeUpload,
  defineActions,
  fromResponse,
  limit,
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
        description: "Notes, optionally filtered by text or status",
        input: z.object({
          q: z.string().optional(),
          status: voiceNoteTranscriptionStatusSchema.optional(),
          limit,
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/voice-notes", query),
      }),
      get: action({
        description: "One note with its transcript",
        input: byId,
        readOnly: true,
        run: ({ voiceNoteId }) =>
          api.web.get(p`/api/admin/voice-notes/${voiceNoteId}`),
      }),
      update: action({
        description: "Renames a note",
        input: z.object({ voiceNoteId, ...voiceNoteTitleSchema.shape }),
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
