import type { CreatePaperInput } from "@repo/schemas";
import type { Types } from "mongoose";
import { redactAgentMemorySource } from "@/lib/agent-memory/source-deletion";
import { prepareNewPaper } from "@/lib/paper-route-utils";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { NoteEmbedding } from "@/models/NoteEmbedding";
import { type ILeanPaper, Paper } from "@/models/Paper";

interface PaperNoteSeed {
  content?: string;
  description?: string;
  groupIds?: Types.ObjectId[];
  manualGroupIds?: Types.ObjectId[];
  publishedDate?: Date;
  status?: "open" | "archived";
  url?: string;
}

interface CreatePaperOptions {
  existingNoteId?: string;
  note?: PaperNoteSeed;
}

function linkedNoteUrl(
  paper: Pick<ILeanPaper, "arxivId" | "doi" | "url">,
  preferred?: string,
): string | undefined {
  return (
    preferred ||
    paper.url ||
    (paper.doi ? `https://doi.org/${paper.doi}` : undefined) ||
    (paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : undefined)
  );
}

function linkedNoteDescription(
  paper: Pick<ILeanPaper, "publisher" | "venue" | "year">,
  preferred?: string,
): string | undefined {
  return (
    preferred ||
    [paper.venue, paper.publisher, paper.year].filter(Boolean).join(" · ") ||
    undefined
  );
}

export async function createPaperWithLinkedNote(
  input: CreatePaperInput,
  options: CreatePaperOptions = {},
): Promise<{ note: ILeanNote; paper: ILeanPaper }> {
  const created = await Paper.create(await prepareNewPaper(input));
  const paper = await Paper.findById(created._id).lean<ILeanPaper>().exec();
  if (!paper) throw new Error("Created paper could not be reloaded");
  let linkedNoteId: Types.ObjectId | string | undefined;
  let createdLinkedNote = false;

  try {
    let note: ILeanNote | null;
    if (options.existingNoteId) {
      note = await Note.findOneAndUpdate(
        {
          _id: options.existingNoteId,
          $or: [{ paperId: { $exists: false } }, { paperId: paper._id }],
        },
        {
          $set: {
            paperId: paper._id,
            class: "paper",
            semanticStatus: "stale",
          },
        },
        { returnDocument: "after", runValidators: true },
      )
        .lean<ILeanNote>()
        .exec();
      if (!note) throw new Error("Legacy note is already linked to a paper");
      linkedNoteId = note._id;
    } else {
      const seed = options.note;
      const createdNote = await Note.create({
        title: paper.title,
        content: seed?.content || paper.abstract || "",
        url: linkedNoteUrl(paper, seed?.url),
        description: linkedNoteDescription(paper, seed?.description),
        publishedDate: seed?.publishedDate || paper.publishedDate,
        tags: paper.tags,
        groupIds: seed?.groupIds ?? [],
        manualGroupIds: seed?.manualGroupIds ?? seed?.groupIds ?? [],
        status: seed?.status ?? "open",
        class: "paper",
        paperId: paper._id,
        semanticStatus: "pending",
      });
      note = await Note.findById(createdNote._id).lean<ILeanNote>().exec();
      if (!note) throw new Error("Linked note could not be reloaded");
      linkedNoteId = note._id;
      createdLinkedNote = true;
    }

    await Paper.updateOne({ _id: paper._id }, { $set: { noteId: note._id } });
    const linkedPaper = await Paper.findById(paper._id)
      .lean<ILeanPaper>()
      .exec();
    if (!linkedPaper) throw new Error("Linked paper could not be reloaded");
    return { note, paper: linkedPaper };
  } catch (error) {
    if (linkedNoteId) {
      if (createdLinkedNote) {
        await Note.deleteOne({ _id: linkedNoteId, paperId: paper._id });
      } else {
        await Note.updateOne(
          { _id: linkedNoteId, paperId: paper._id },
          { $unset: { paperId: "" } },
        );
      }
    }
    await Paper.deleteOne({ _id: paper._id });
    throw error;
  }
}

export async function ensurePaperNote(paper: ILeanPaper): Promise<ILeanNote> {
  const existing = await Note.findOne({
    $or: [
      ...(paper.noteId ? [{ _id: paper.noteId }] : []),
      { paperId: paper._id },
    ],
  })
    .lean<ILeanNote>()
    .exec();
  if (existing) {
    const linked = await Note.findByIdAndUpdate(
      existing._id,
      {
        $set: {
          paperId: paper._id,
          class: "paper",
        },
      },
      { returnDocument: "after", runValidators: true },
    )
      .lean<ILeanNote>()
      .exec();
    if (!linked) throw new Error("Linked note could not be repaired");
    if (!paper.noteId) {
      await Paper.updateOne(
        { _id: paper._id },
        { $set: { noteId: linked._id } },
      );
    }
    return linked;
  }

  const created = await Note.create({
    title: paper.title,
    content: paper.abstract || "",
    url: linkedNoteUrl(paper),
    description: linkedNoteDescription(paper),
    publishedDate: paper.publishedDate,
    tags: paper.tags,
    groupIds: [],
    manualGroupIds: [],
    status: "open",
    class: "paper",
    paperId: paper._id,
    semanticStatus: "pending",
  });
  await Paper.updateOne({ _id: paper._id }, { $set: { noteId: created._id } });
  const note = await Note.findById(created._id).lean<ILeanNote>().exec();
  if (!note) throw new Error("Linked note could not be reloaded");
  return note;
}

export async function syncPaperNote(paper: ILeanPaper): Promise<void> {
  const note = await ensurePaperNote(paper);
  await Note.updateOne(
    { _id: note._id },
    {
      $set: {
        title: paper.title,
        content: paper.abstract || "",
        url: linkedNoteUrl(paper),
        description: linkedNoteDescription(paper),
        publishedDate: paper.publishedDate,
        tags: paper.tags,
        class: "paper",
        paperId: paper._id,
        semanticStatus: "stale",
      },
    },
  );
}

export async function deleteLinkedPaperNote(paper: ILeanPaper): Promise<void> {
  const note = await Note.findOne({
    $or: [
      ...(paper.noteId ? [{ _id: paper.noteId }] : []),
      { paperId: paper._id },
    ],
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  if (!note) return;

  const noteId = String(note._id);
  await redactAgentMemorySource({ entityType: "note", entityId: noteId });
  await Promise.all([
    Note.deleteOne({ _id: note._id }),
    NoteEdge.deleteMany({ $or: [{ from: note._id }, { to: note._id }] }),
    NoteEmbedding.deleteMany({ noteId: note._id }),
    KnowledgeSemanticSuggestion.updateMany(
      { noteId: note._id, status: "pending" },
      { $set: { status: "superseded", decidedAt: new Date() } },
    ),
  ]);
}
