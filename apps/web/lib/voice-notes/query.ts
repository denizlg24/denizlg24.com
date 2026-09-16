import "server-only";

import {
  type VoiceNoteFacetsResponse,
  type VoiceNoteListQuery,
  type VoiceNotesResponse,
  voiceNoteListQuerySchema,
} from "@repo/schemas";
import mongoose, { type QueryFilter } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Note } from "@/models/Note";
import { NoteGroup } from "@/models/NoteGroup";
import { TimetableEntry } from "@/models/TimetableEntry";
import {
  type ILeanVoiceNote,
  type IVoiceNote,
  VoiceNote,
} from "@/models/VoiceNote";
import { matchFor, searchTerms } from "./search";
import { loadVoiceNoteRelations, serializeVoiceNoteSummary } from "./serialize";

const DEFAULT_LIMIT = 50;

/** Repeated params are arrays; booleans and numbers arrive as strings. */
export function parseVoiceNoteListQuery(params: URLSearchParams) {
  const many = (key: string) => {
    const values = params.getAll(key).filter((value) => value.trim() !== "");
    return values.length ? values : undefined;
  };
  const number = (key: string) => {
    const value = params.get(key);
    return value === null || value.trim() === "" ? undefined : Number(value);
  };
  const linked = params.get("linked");
  return voiceNoteListQuerySchema.safeParse({
    q: params.get("q") || undefined,
    status: many("status"),
    source: many("source"),
    tag: many("tag"),
    groupId: many("groupId"),
    contextId: many("contextId"),
    context: params.get("context") || undefined,
    linked: linked === "true" ? true : linked === "false" ? false : undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    sort: params.get("sort") || undefined,
    limit: number("limit"),
    offset: number("offset"),
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function objectIds(values: string[] | undefined) {
  return (values ?? [])
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

/**
 * Built with explicit ObjectIds and Dates because the same filter feeds an
 * aggregation, which does not cast the way `find` does.
 */
async function buildFilter(
  query: VoiceNoteListQuery,
): Promise<QueryFilter<IVoiceNote>> {
  const clauses: QueryFilter<IVoiceNote>[] = [];

  // Substring rather than $text: the owner searches for fragments of what was
  // said, and $text only matches whole stemmed words. A single owner's
  // recordings are few enough for the unanchored scan.
  for (const term of searchTerms(query.q)) {
    const pattern = new RegExp(escapeRegex(term), "i");
    clauses.push({
      $or: [
        { title: pattern },
        { tags: pattern },
        { "transcription.text": pattern },
      ],
    });
  }
  if (query.status?.length) {
    clauses.push({ "transcription.status": { $in: query.status } });
  }
  if (query.source?.length) clauses.push({ source: { $in: query.source } });
  if (query.tag?.length) {
    clauses.push({ tags: { $in: query.tag.map((tag) => tag.toLowerCase()) } });
  }
  if (query.contextId?.length) {
    clauses.push({ "context.id": { $in: objectIds(query.contextId) } });
  }
  if (query.context === "any") clauses.push({ context: { $exists: true } });
  if (query.context === "none") clauses.push({ context: { $exists: false } });
  if (query.linked === true) clauses.push({ "noteIds.0": { $exists: true } });
  if (query.linked === false) clauses.push({ "noteIds.0": { $exists: false } });
  if (query.from || query.to) {
    clauses.push({
      recordedAt: {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      },
    });
  }
  if (query.groupId?.length) {
    const notes = await Note.find({
      groupIds: { $in: objectIds(query.groupId) },
    })
      .select("_id")
      .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
      .exec();
    clauses.push({ noteIds: { $in: notes.map((note) => note._id) } });
  }
  return clauses.length ? { $and: clauses } : {};
}

function sortFor(query: VoiceNoteListQuery): Record<string, 1 | -1> {
  switch (query.sort) {
    case "oldest":
      return { recordedAt: 1, _id: 1 };
    case "longest":
      return { durationMs: -1, recordedAt: -1 };
    case "shortest":
      return { durationMs: 1, recordedAt: -1 };
    default:
      return { recordedAt: -1, _id: -1 };
  }
}

export async function listVoiceNotes(
  query: VoiceNoteListQuery,
): Promise<VoiceNotesResponse> {
  await connectDB();
  const filter = await buildFilter(query);
  const limit = query.limit ?? DEFAULT_LIMIT;
  const [voiceNotes, total, duration] = await Promise.all([
    VoiceNote.find(filter)
      .sort(sortFor(query))
      .skip(query.offset ?? 0)
      .limit(limit)
      .lean<ILeanVoiceNote[]>()
      .exec(),
    VoiceNote.countDocuments(filter).exec(),
    VoiceNote.aggregate<{ totalDurationMs: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalDurationMs: { $sum: { $ifNull: ["$durationMs", 0] } },
        },
      },
    ]).exec(),
  ]);
  const relations = await loadVoiceNoteRelations(voiceNotes);
  const terms = searchTerms(query.q);
  return {
    voiceNotes: voiceNotes.map((voiceNote) =>
      serializeVoiceNoteSummary(
        voiceNote,
        relations.get(String(voiceNote._id)),
        matchFor(voiceNote, terms),
      ),
    ),
    total,
    totalDurationMs: duration[0]?.totalDurationMs ?? 0,
  };
}

export async function voiceNoteFacets(): Promise<VoiceNoteFacetsResponse> {
  await connectDB();
  const [tags, statuses, sources, contexts, linked] = await Promise.all([
    VoiceNote.aggregate<{ _id: string; count: number }>([
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]).exec(),
    VoiceNote.aggregate<{
      _id: VoiceNoteFacetsResponse["statuses"][number]["status"];
      count: number;
    }>([
      { $group: { _id: "$transcription.status", count: { $sum: 1 } } },
    ]).exec(),
    VoiceNote.aggregate<{
      _id: VoiceNoteFacetsResponse["sources"][number]["source"];
      count: number;
    }>([{ $group: { _id: "$source", count: { $sum: 1 } } }]).exec(),
    VoiceNote.aggregate<{
      _id: {
        kind: VoiceNoteFacetsResponse["contexts"][number]["kind"];
        id: mongoose.Types.ObjectId;
      };
      count: number;
    }>([
      { $match: { context: { $exists: true } } },
      {
        $group: {
          _id: { kind: "$context.kind", id: "$context.id" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]).exec(),
    VoiceNote.find({ "noteIds.0": { $exists: true } })
      .select("noteIds")
      .lean<Array<{ noteIds: mongoose.Types.ObjectId[] }>>()
      .exec(),
  ]);

  const eventIds = contexts
    .filter((entry) => entry._id.kind === "calendar-event")
    .map((entry) => entry._id.id);
  const entryIds = contexts
    .filter((entry) => entry._id.kind === "timetable-entry")
    .map((entry) => entry._id.id);
  const noteIds = [
    ...new Set(linked.flatMap((row) => row.noteIds.map(String))),
  ];
  const [events, entries, notes] = await Promise.all([
    eventIds.length
      ? CalendarEvent.find({ _id: { $in: eventIds } })
          .select("title")
          .lean<Array<{ _id: mongoose.Types.ObjectId; title: string }>>()
          .exec()
      : Promise.resolve([]),
    entryIds.length
      ? TimetableEntry.find({ _id: { $in: entryIds } })
          .select("title")
          .lean<Array<{ _id: mongoose.Types.ObjectId; title: string }>>()
          .exec()
      : Promise.resolve([]),
    noteIds.length
      ? Note.find({ _id: { $in: noteIds } })
          .select("groupIds")
          .lean<
            Array<{
              _id: mongoose.Types.ObjectId;
              groupIds?: mongoose.Types.ObjectId[];
            }>
          >()
          .exec()
      : Promise.resolve([]),
  ]);
  const titleById = new Map(
    [...events, ...entries].map((row) => [String(row._id), row.title]),
  );

  const groupsByNote = new Map(
    notes.map((note) => [String(note._id), (note.groupIds ?? []).map(String)]),
  );
  const groupCounts = new Map<string, number>();
  for (const row of linked) {
    const groupIds = new Set(
      row.noteIds.flatMap((noteId) => groupsByNote.get(String(noteId)) ?? []),
    );
    for (const groupId of groupIds) {
      groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
    }
  }
  const groups = groupCounts.size
    ? await NoteGroup.find({ _id: { $in: [...groupCounts.keys()] } })
        .select("name color")
        .lean<
          Array<{ _id: mongoose.Types.ObjectId; name: string; color?: string }>
        >()
        .exec()
    : [];

  return {
    tags: tags.map((tag) => ({ name: tag._id, count: tag.count })),
    groups: groups
      .map((group) => ({
        _id: String(group._id),
        name: group.name,
        color: group.color,
        count: groupCounts.get(String(group._id)) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    contexts: contexts.flatMap((entry) => {
      const title = titleById.get(String(entry._id.id));
      return title
        ? [
            {
              kind: entry._id.kind,
              id: String(entry._id.id),
              title,
              count: entry.count,
            },
          ]
        : [];
    }),
    sources: sources.map((row) => ({ source: row._id, count: row.count })),
    statuses: statuses.map((row) => ({ status: row._id, count: row.count })),
  };
}
