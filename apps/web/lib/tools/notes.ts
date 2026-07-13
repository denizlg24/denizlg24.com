import mongoose from "mongoose";
import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { connectDB } from "@/lib/mongodb";
import { pruneGroupIds } from "@/lib/note-route-utils";
import { Note } from "@/models/Note";
import { NoteGroup } from "@/models/NoteGroup";
import type { ToolDefinition } from "./types";

export const notesTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_groups",
      description:
        "List all note groups and their hierarchy. Returns group names, IDs, and parent relationships.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "notes",
    execute: async () => {
      await connectDB();
      const groups = await NoteGroup.find().sort({ name: 1 }).lean();
      return groups.map((group) => ({
        _id: String(group._id),
        name: group.name,
        description: group.description,
        color: group.color,
        parentId: group.parentId ? String(group.parentId) : null,
        autoCreated: group.autoCreated,
      }));
    },
  },
  {
    schema: {
      name: "create_group",
      description: "Create a new note group.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Group name" },
          description: {
            type: "string",
            description: "Group description (optional)",
          },
          color: {
            type: "string",
            description: "Group color in hex (optional)",
          },
          parentId: {
            type: "string",
            description: "Parent group ID (optional)",
          },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const group = await NoteGroup.create({
        name: input.name as string,
        description: input.description as string | undefined,
        color: input.color as string | undefined,
        parentId: (input.parentId as string | undefined) || null,
        autoCreated: false,
      });
      return {
        _id: group._id.toString(),
        name: group.name,
        parentId: group.parentId ? String(group.parentId) : null,
      };
    },
  },
  {
    schema: {
      name: "update_group",
      description: "Update a note group's name, description, color, or parent.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Group ID" },
          name: { type: "string", description: "New name (optional)" },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          color: {
            type: "string",
            description: "New color in hex (optional)",
          },
          parentId: {
            type: "string",
            description: "New parent group ID (optional, null for top level)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.color !== undefined) data.color = input.color;
      if (input.parentId !== undefined) data.parentId = input.parentId || null;

      const group = await NoteGroup.findByIdAndUpdate(
        input.id as string,
        data,
        {
          returnDocument: "after",
        },
      ).lean();
      if (!group) throw new Error("Group not found");

      return {
        _id: String(group._id),
        name: group.name,
        parentId: group.parentId ? String(group.parentId) : null,
      };
    },
  },
  {
    schema: {
      name: "delete_group",
      description:
        "Delete a note group. Notes keep their content but lose membership in that group.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Group ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const group = await NoteGroup.findByIdAndDelete(input.id as string);
      if (!group) throw new Error("Group not found");
      await Note.updateMany(
        { groupIds: group._id },
        { $pull: { groupIds: group._id } },
      );
      await NoteGroup.updateMany(
        { parentId: group._id },
        { $set: { parentId: null } },
      );
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_notes",
      description:
        "List notes with their titles and metadata. Supports pagination.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max number of notes to return (default 20)",
          },
          offset: {
            type: "number",
            description: "Number of notes to skip (default 0)",
          },
        },
      },
    },
    isWrite: false,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 20;
      const offset = (input.offset as number) || 0;
      const notes = await Note.find()
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();
      return notes.map((note) => ({
        _id: note._id.toString(),
        title: note.title,
        preview: note.content.slice(0, 200),
        url: note.url,
        tags: note.tags,
        groupIds: (note.groupIds ?? []).map(String),
        status: note.status,
        updatedAt: note.updatedAt,
      }));
    },
  },
  {
    schema: {
      name: "get_note",
      description: "Get a note by ID.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern: "^[a-fA-F0-9]{24}$",
            description:
              "MongoDB note _id returned by list_notes or search_notes",
          },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "notes",
    execute: async (input) => {
      const id = input.id as string;
      if (!mongoose.isValidObjectId(id)) {
        throw new Error(
          "Invalid note ID. Use the _id returned by list_notes or search_notes.",
        );
      }
      await connectDB();
      const note = await Note.findById(new mongoose.Types.ObjectId(id)).lean();
      if (!note) throw new Error("Note not found");
      return {
        _id: note._id.toString(),
        title: note.title,
        content: note.content,
        url: note.url,
        description: note.description,
        tags: note.tags,
        groupIds: (note.groupIds ?? []).map(String),
        status: note.status,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    },
  },
  {
    schema: {
      name: "search_notes",
      description: "Search notes by text query across title and content.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
          limit: {
            type: "number",
            description: "Max results to return (default 10)",
          },
        },
        required: ["query"],
      },
    },
    isWrite: false,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 10;
      const query = input.query as string;
      const notes = await Note.find(
        { $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();
      return notes.map((note) => ({
        _id: note._id.toString(),
        title: note.title,
        preview: note.content.slice(0, 200),
        url: note.url,
        status: note.status,
        updatedAt: note.updatedAt,
      }));
    },
  },
  {
    schema: {
      name: "create_note",
      description:
        "Create a new note. URL is optional. Do not invent groupIds or tags during creation; leave semantic grouping/tagging to the semantic_classify_note client tool unless the user explicitly provided groups or tags.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title" },
          content: {
            type: "string",
            description: "Markdown content (optional)",
          },
          url: {
            type: "string",
            description:
              "Source URL if this note is also a saved link (optional)",
          },
          description: {
            type: "string",
            description: "Description (optional)",
          },
          groupIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Manual group IDs explicitly requested by the user (optional). Do not infer these yourself.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Manual tags explicitly requested by the user (optional). Do not infer these yourself.",
          },
          status: {
            type: "string",
            enum: ["open", "archived"],
            description: "Status (optional)",
          },
          class: {
            type: "string",
            description: "Custom class/category (optional)",
          },
        },
        required: ["title"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const groupIds = Array.isArray(input.groupIds)
        ? await pruneGroupIds(input.groupIds as string[])
        : [];
      const note = await Note.create({
        title: input.title as string,
        content: (input.content as string | undefined) ?? "",
        url: input.url as string | undefined,
        description: input.description as string | undefined,
        groupIds,
        manualGroupIds: groupIds,
        tags: (input.tags as string[] | undefined) ?? [],
        status:
          input.status === "archived" || input.status === "open"
            ? input.status
            : "open",
        class: input.class as string | undefined,
      });
      return {
        _id: note._id.toString(),
        title: note.title,
        content: note.content,
        groupIds: groupIds.map(String),
        semanticStatus: note.semanticStatus,
        semanticClassificationRequired: true,
        nextClientTool: {
          name: "semantic_classify_note",
          input: { noteId: note._id.toString() },
        },
      };
    },
  },
  {
    schema: {
      name: "update_note",
      description:
        "Update an existing note. Use groupIds only when the user explicitly wants to replace manual group membership. After changing title, content, URL, description, groups, tags, or class, call semantic_classify_note so the server can refresh semantic keywords and produce/apply grouping or tag changes.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID" },
          title: { type: "string", description: "New title (optional)" },
          content: { type: "string", description: "New content (optional)" },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          url: { type: "string", description: "New URL (optional)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Replacement manual tags explicitly requested by the user (optional)",
          },
          groupIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Replacement manual group IDs explicitly requested by the user (optional)",
          },
          status: {
            type: "string",
            enum: ["open", "archived"],
            description: "New status (optional)",
          },
          class: {
            type: "string",
            description: "New class/category (optional)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const data: Record<string, unknown> = {};
      let semanticClassificationRequired = false;
      if (input.title !== undefined) {
        data.title = input.title;
        semanticClassificationRequired = true;
      }
      if (input.content !== undefined) {
        data.content = input.content;
        semanticClassificationRequired = true;
      }
      if (input.description !== undefined) {
        data.description = input.description;
        semanticClassificationRequired = true;
      }
      if (input.url !== undefined) {
        data.url = input.url;
        semanticClassificationRequired = true;
      }
      if (input.tags !== undefined) {
        data.tags = input.tags;
        semanticClassificationRequired = true;
      }
      if (input.groupIds !== undefined) {
        const groupIds = await pruneGroupIds(input.groupIds as string[]);
        data.groupIds = groupIds;
        data.manualGroupIds = groupIds;
        semanticClassificationRequired = true;
      }
      if (input.status !== undefined) data.status = input.status;
      if (input.class !== undefined) {
        data.class = input.class;
        semanticClassificationRequired = true;
      }
      if (semanticClassificationRequired) data.semanticStatus = "stale";

      const note = await Note.findByIdAndUpdate(input.id as string, data, {
        returnDocument: "after",
      }).lean();
      if (!note) throw new Error("Note not found");
      return {
        _id: note._id.toString(),
        title: note.title,
        content: note.content,
        groupIds: (note.groupIds ?? []).map(String),
        semanticStatus: note.semanticStatus,
        semanticClassificationRequired,
        nextClientTool: semanticClassificationRequired
          ? {
              name: "semantic_classify_note",
              input: { noteId: note._id.toString() },
            }
          : undefined,
      };
    },
  },
  {
    schema: {
      name: "delete_note",
      description: "Delete a note and its graph edges.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "notes",
    execute: async (input) => {
      await connectDB();
      const id = input.id as string;
      const note = await Note.findById(id);
      if (!note) throw new Error("Note not found");
      await redactAgentMemorySource({ entityType: "note", entityId: id });
      await Note.deleteOne({ _id: id });
      const { NoteEdge } = await import("@/models/NoteEdge");
      await NoteEdge.deleteMany({
        $or: [{ from: note._id }, { to: note._id }],
      });
      return { success: true };
    },
  },
];
