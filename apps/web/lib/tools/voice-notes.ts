import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { serializeNote } from "@/lib/note-route-utils";
import { generateNoteFromVoice } from "@/lib/voice-notes/generate-note";
import {
  normalizeVoiceNoteIds,
  syncVoiceNoteLinks,
} from "@/lib/voice-notes/linking";
import { deleteVoiceNote, renameVoiceNote } from "@/lib/voice-notes/mutations";
import { serializeVoiceNote } from "@/lib/voice-notes/serialize";
import { enqueueVoiceNoteTranscription } from "@/lib/voice-notes/transcription";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanVoiceNote, VoiceNote } from "@/models/VoiceNote";
import type { ToolDefinition } from "./types";

function requireId(value: unknown, label: string) {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${label} ID`);
  }
  return value;
}

export const voiceNotesTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_voice_notes",
      description:
        "List stored voice notes, their transcription state, duration, linked notes, and a short transcript preview.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional text search across title and transcript.",
          },
          limit: {
            type: "number",
            description: "Maximum results, from 1 to 50 (default 20).",
          },
        },
      },
    },
    isWrite: false,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const query =
        typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
      const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
      const voiceNotes = await VoiceNote.find(
        query ? { $text: { $search: query } } : {},
      )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean<ILeanVoiceNote[]>()
        .exec();
      // Search results carry a preview, not the whole transcript; the full
      // text is what get_voice_note is for.
      return voiceNotes.map((voiceNote) => {
        const serialized = serializeVoiceNote(voiceNote);
        return {
          ...serialized,
          transcription: {
            ...serialized.transcription,
            ...(serialized.transcription.text === undefined
              ? {}
              : { text: serialized.transcription.text.slice(0, 500) }),
          },
        };
      });
    },
  },
  {
    schema: {
      name: "get_voice_note",
      description:
        "Get one voice note with its complete transcription and linked note IDs.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Voice note ID." },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "notes",
    execute: async (input) => {
      const id = requireId(input.id, "voice note");
      await connectDB();
      const voiceNote = await VoiceNote.findById(id)
        .lean<ILeanVoiceNote>()
        .exec();
      if (!voiceNote) throw new Error("Voice note not found");
      return serializeVoiceNote(voiceNote);
    },
  },
  {
    schema: {
      name: "transcribe_voice_note",
      description:
        "Queue a stored voice note for direct OpenAI transcription. Use force only to retry or replace an existing transcript.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Voice note ID." },
          force: {
            type: "boolean",
            description: "Retry or replace an existing transcription.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      const id = requireId(input.id, "voice note");
      const result = await enqueueVoiceNoteTranscription(id, {
        retryFailed: input.force === true,
      });
      return {
        queued: result.queued,
        voiceNote: serializeVoiceNote(result.voiceNote),
      };
    },
  },
  {
    schema: {
      name: "attach_voice_note_to_note",
      description:
        "Attach an existing voice note to an existing note so the playable voice card appears in the note editor.",
      input_schema: {
        type: "object",
        properties: {
          voiceNoteId: { type: "string", description: "Voice note ID." },
          noteId: { type: "string", description: "Note ID." },
        },
        required: ["voiceNoteId", "noteId"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      const voiceNoteId = requireId(input.voiceNoteId, "voice note");
      const noteId = requireId(input.noteId, "note");
      await connectDB();
      const note = await Note.findById(noteId).lean<ILeanNote>().exec();
      if (!note) throw new Error("Note not found");
      const nextIds = [
        ...new Set([...(note.voiceNoteIds ?? []).map(String), voiceNoteId]),
      ];
      const normalized = await normalizeVoiceNoteIds(nextIds);
      // Both sides of the link commit together; see syncVoiceNoteLinks.
      let updated: ILeanNote | null = null;
      const session = await Note.startSession();
      try {
        await session.withTransaction(async () => {
          updated = await Note.findByIdAndUpdate(
            noteId,
            {
              $set: {
                voiceNoteIds: normalized,
                semanticStatus: "stale",
              },
            },
            { returnDocument: "after", runValidators: true, session },
          )
            .lean<ILeanNote>()
            .exec();
          if (!updated) return;
          await syncVoiceNoteLinks(noteId, normalized, session);
        });
      } finally {
        await session.endSession();
      }
      if (!updated) throw new Error("Note not found");
      return { note: serializeNote(updated) };
    },
  },
  {
    schema: {
      name: "create_note_from_voice",
      description:
        "Generate a structured Markdown note from a transcribed voice note and attach the recording to it.",
      input_schema: {
        type: "object",
        properties: {
          voiceNoteId: { type: "string", description: "Voice note ID." },
          groupIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional note group IDs.",
          },
        },
        required: ["voiceNoteId"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      const voiceNoteId = requireId(input.voiceNoteId, "voice note");
      const result = await generateNoteFromVoice({
        voiceNoteId,
        groupIds: Array.isArray(input.groupIds)
          ? input.groupIds.filter(
              (value): value is string => typeof value === "string",
            )
          : undefined,
      });
      return {
        note: serializeNote(result.note),
        usage: result.usage,
      };
    },
  },
  {
    schema: {
      name: "rename_voice_note",
      description:
        "Rename a voice note. Marks the title as manually set, so the automatic titler will not overwrite it.",
      input_schema: {
        type: "object",
        properties: {
          voiceNoteId: { type: "string", description: "Voice note ID" },
          title: { type: "string", description: "New title" },
        },
        required: ["voiceNoteId", "title"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      const voiceNoteId = requireId(input.voiceNoteId, "voice note");
      const title = String(input.title ?? "").trim();
      if (!title) throw new Error("Title is required");
      const voiceNote = await renameVoiceNote(voiceNoteId, title);
      if (!voiceNote) throw new Error("Voice note not found");
      return serializeVoiceNote(voiceNote);
    },
  },
  {
    schema: {
      name: "delete_voice_note",
      description:
        "Delete a voice note and its audio. Detaches it from any notes, cancels a pending transcription and redacts memories formed from it. Not reversible — the audio is gone.",
      input_schema: {
        type: "object",
        properties: {
          voiceNoteId: { type: "string", description: "Voice note ID" },
        },
        required: ["voiceNoteId"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      const voiceNoteId = requireId(input.voiceNoteId, "voice note");
      const deleted = await deleteVoiceNote(voiceNoteId);
      if (!deleted) throw new Error("Voice note not found");
      return { success: true };
    },
  },
];
