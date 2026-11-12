import {
  type KnowledgeSourceKey,
  type KnowledgeSourceKind,
  knowledgeSourceKey,
  type NotebookCreate,
  type NotebookDetail,
  type NotebookResolvedSource,
  type NotebookSourcesPatch,
  type NotebookSummary,
  type NotebookUpdate,
  type Notebook as NotebookWire,
  notebookCreateSchema,
  notebookSourcesPatchSchema,
  notebookUpdateSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { sourceIndexStatus } from "@/lib/knowledge/status";
import { connectDB } from "@/lib/mongodb";
import { Conversation } from "@/models/Conversation";
import { Course } from "@/models/Course";
import { Deck } from "@/models/Deck";
import { Flashcard } from "@/models/Flashcard";
import { Note } from "@/models/Note";
import { type ILeanNotebook, Notebook } from "@/models/Notebook";
import { Quiz } from "@/models/Quiz";
import { QuizAttemptModel } from "@/models/QuizAttempt";
import { ReviewLog } from "@/models/ReviewLog";
import { StudyDocument } from "@/models/StudyDocument";
import { StudyQuestion } from "@/models/StudyQuestion";
import { VoiceNote } from "@/models/VoiceNote";
import { cardCountsBy } from "./counts";
import { listDecks } from "./decks";
import { NotebookNotFoundError, toObjectId } from "./errors";
import {
  type EffectiveNotebookSource,
  effectiveNotebookSources,
  loadCourseNoteIds,
} from "./notebook-sources";
import { listQuizzes } from "./quizzes";

const notebookMissing = (id: string) => () => new NotebookNotFoundError(id);

function notebookToWire(notebook: ILeanNotebook): NotebookWire {
  return {
    _id: String(notebook._id),
    title: notebook.title,
    ...(notebook.icon ? { icon: notebook.icon } : {}),
    ...(notebook.courseId ? { courseId: String(notebook.courseId) } : {}),
    sources: notebook.sources.map((source) => ({
      kind: source.kind,
      id: String(source.id),
      addedAt: source.addedAt.toISOString(),
    })),
    excluded: notebook.excluded.filter(isSourceKey),
    ...(notebook.archivedAt
      ? { archivedAt: notebook.archivedAt.toISOString() }
      : {}),
    createdAt: notebook.createdAt.toISOString(),
    updatedAt: notebook.updatedAt.toISOString(),
  };
}

function isSourceKey(value: string): value is KnowledgeSourceKey {
  return /^(note|document|voice-note):[a-f0-9]{24}$/i.test(value);
}

function sourcesOf(
  notebook: ILeanNotebook,
  courseNotes: ReadonlyMap<string, string[]>,
): EffectiveNotebookSource[] {
  return effectiveNotebookSources({
    courseNoteIds: notebook.courseId
      ? (courseNotes.get(String(notebook.courseId)) ?? [])
      : [],
    sources: notebook.sources.map((source) => ({
      kind: source.kind,
      id: String(source.id),
    })),
    excluded: notebook.excluded,
  });
}

async function countsByNotebook(
  ids: mongoose.Types.ObjectId[],
): Promise<Map<string, { decks: number; quizzes: number; questions: number }>> {
  if (ids.length === 0) return new Map();
  const tally = async (
    aggregate: (
      pipeline: mongoose.PipelineStage[],
    ) => Promise<{ _id: mongoose.Types.ObjectId; n: number }[]>,
  ) => {
    const rows = await aggregate([
      { $match: { notebookId: { $in: ids } } },
      { $group: { _id: "$notebookId", n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.n]));
  };
  const [decks, quizzes, questions] = await Promise.all([
    tally((pipeline) => Deck.aggregate(pipeline)),
    tally((pipeline) => Quiz.aggregate(pipeline)),
    tally((pipeline) => StudyQuestion.aggregate(pipeline)),
  ]);
  return new Map(
    ids.map((id) => {
      const key = String(id);
      return [
        key,
        {
          decks: decks.get(key) ?? 0,
          quizzes: quizzes.get(key) ?? 0,
          questions: questions.get(key) ?? 0,
        },
      ];
    }),
  );
}

async function summarize(
  notebooks: ILeanNotebook[],
): Promise<NotebookSummary[]> {
  const courseIds = [
    ...new Set(
      notebooks.flatMap((n) => (n.courseId ? [String(n.courseId)] : [])),
    ),
  ];
  const ids = notebooks.map((notebook) => notebook._id);
  const [courseNotes, courses, counts, cards] = await Promise.all([
    loadCourseNoteIds(courseIds),
    courseIds.length > 0
      ? Course.find({ _id: { $in: courseIds } })
          .select({ name: 1, code: 1 })
          .lean<
            { _id: mongoose.Types.ObjectId; name: string; code?: string }[]
          >()
      : Promise.resolve([]),
    countsByNotebook(ids),
    cardCountsBy("notebookId", ids, new Date()),
  ]);
  const courseById = new Map(
    courses.map((course) => [String(course._id), course]),
  );
  return notebooks.map((notebook) => {
    const course = notebook.courseId
      ? courseById.get(String(notebook.courseId))
      : undefined;
    const key = String(notebook._id);
    const count = counts.get(key);
    const card = cards.get(key);
    return {
      ...notebookToWire(notebook),
      ...(course ? { courseName: course.name } : {}),
      ...(course?.code ? { courseCode: course.code } : {}),
      sourceCount: sourcesOf(notebook, courseNotes).filter((s) => !s.excluded)
        .length,
      deckCount: count?.decks ?? 0,
      quizCount: count?.quizzes ?? 0,
      cardCount: card?.total ?? 0,
      cardsDue: card?.due ?? 0,
    };
  });
}

export async function listNotebooks(
  opts: { archived?: boolean } = {},
): Promise<NotebookSummary[]> {
  await connectDB();
  const notebooks = await Notebook.find(
    opts.archived
      ? { archivedAt: { $exists: true } }
      : { archivedAt: { $exists: false } },
  )
    .sort({ updatedAt: -1 })
    .lean<ILeanNotebook[]>();
  return summarize(notebooks);
}

async function summaryFor(
  id: mongoose.Types.ObjectId,
): Promise<NotebookSummary> {
  const notebook = await Notebook.findById(id).lean<ILeanNotebook>();
  if (!notebook) throw new NotebookNotFoundError(String(id));
  const [summary] = await summarize([notebook]);
  if (!summary) throw new NotebookNotFoundError(String(id));
  return summary;
}

export async function createNotebook(
  input: NotebookCreate,
): Promise<NotebookSummary> {
  const data = notebookCreateSchema.parse(input);
  await connectDB();
  const seen = new Set<string>();
  const sources = (data.sources ?? [])
    .filter((source) => {
      const key = knowledgeSourceKey(source.kind, source.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((source) => ({
      kind: source.kind,
      id: new mongoose.Types.ObjectId(source.id),
      addedAt: new Date(),
    }));
  const created = await Notebook.create({
    title: data.title,
    ...(data.icon ? { icon: data.icon } : {}),
    ...(data.courseId
      ? { courseId: new mongoose.Types.ObjectId(data.courseId) }
      : {}),
    sources,
  });
  return summaryFor(created._id);
}

export async function updateNotebook(
  id: string,
  input: NotebookUpdate,
): Promise<NotebookSummary> {
  const data = notebookUpdateSchema.parse(input);
  await connectDB();
  const notebookId = toObjectId(id, notebookMissing(id));
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (data.title !== undefined) set.title = data.title;
  if (data.icon === null) unset.icon = "";
  else if (data.icon !== undefined) set.icon = data.icon;
  if (data.courseId === null) unset.courseId = "";
  else if (data.courseId !== undefined) {
    set.courseId = new mongoose.Types.ObjectId(data.courseId);
  }
  if (data.archived === true) set.archivedAt = new Date();
  else if (data.archived === false) unset.archivedAt = "";
  const updated = await Notebook.findByIdAndUpdate(
    notebookId,
    { $set: set, $unset: unset },
    { new: true },
  ).lean<ILeanNotebook>();
  if (!updated) throw new NotebookNotFoundError(id);
  return summaryFor(notebookId);
}

/** Documents may be shared between notebooks, so they stay. */
export async function deleteNotebook(id: string): Promise<void> {
  await connectDB();
  const notebookId = toObjectId(id, notebookMissing(id));
  const deleted = await Notebook.findByIdAndDelete(notebookId);
  if (!deleted) throw new NotebookNotFoundError(id);
  await Promise.all([
    Deck.deleteMany({ notebookId }),
    Flashcard.deleteMany({ notebookId }),
    ReviewLog.deleteMany({ notebookId }),
    StudyQuestion.deleteMany({ notebookId }),
    Quiz.deleteMany({ notebookId }),
    QuizAttemptModel.deleteMany({ notebookId }),
  ]);
}

interface TitledSource {
  _id: mongoose.Types.ObjectId;
  title: string;
  updatedAt?: Date;
}

async function titlesFor(
  sources: readonly EffectiveNotebookSource[],
): Promise<Map<KnowledgeSourceKey, TitledSource>> {
  const idsOf = (kind: KnowledgeSourceKind) =>
    sources.filter((s) => s.kind === kind).map((s) => s.id);
  const fields = { title: 1, updatedAt: 1 };
  const [notes, documents, voiceNotes] = await Promise.all([
    Note.find({ _id: { $in: idsOf("note") } })
      .select(fields)
      .lean<TitledSource[]>(),
    StudyDocument.find({ _id: { $in: idsOf("document") } })
      .select(fields)
      .lean<TitledSource[]>(),
    VoiceNote.find({ _id: { $in: idsOf("voice-note") } })
      .select(fields)
      .lean<TitledSource[]>(),
  ]);
  const result = new Map<KnowledgeSourceKey, TitledSource>();
  for (const [kind, rows] of [
    ["note", notes],
    ["document", documents],
    ["voice-note", voiceNotes],
  ] as const) {
    for (const row of rows) {
      result.set(knowledgeSourceKey(kind, String(row._id)), row);
    }
  }
  return result;
}

async function latestConversationId(
  notebookId: mongoose.Types.ObjectId,
): Promise<string | undefined> {
  const conversation = await Conversation.findOne({
    notebookId: { $in: [notebookId, String(notebookId)] },
  })
    .sort({ updatedAt: -1 })
    .select({ _id: 1 })
    .lean<{ _id: mongoose.Types.ObjectId }>();
  return conversation ? String(conversation._id) : undefined;
}

export async function getNotebookDetail(id: string): Promise<NotebookDetail> {
  await connectDB();
  const notebookId = toObjectId(id, notebookMissing(id));
  const notebook = await Notebook.findById(notebookId).lean<ILeanNotebook>();
  if (!notebook) throw new NotebookNotFoundError(id);

  const courseNotes = notebook.courseId
    ? await loadCourseNoteIds([String(notebook.courseId)])
    : new Map<string, string[]>();
  const effective = sourcesOf(notebook, courseNotes);
  const keys = effective.map((source) => source.sourceKey);

  const [summary, titles, statuses, decks, quizzes, counts, conversationId] =
    await Promise.all([
      summaryFor(notebookId),
      titlesFor(effective),
      sourceIndexStatus(keys),
      listDecks(id),
      listQuizzes(id),
      countsByNotebook([notebookId]),
      latestConversationId(notebookId),
    ]);

  const sources: NotebookResolvedSource[] = [];
  for (const source of effective) {
    const record = titles.get(source.sourceKey);
    if (!record) continue;
    const status = statuses.get(source.sourceKey);
    sources.push({
      sourceKey: source.sourceKey,
      kind: source.kind,
      id: source.id,
      title: record.title,
      origin: source.origin,
      excluded: source.excluded,
      chunkCount: status?.chunkCount ?? 0,
      status: status?.status ?? "pending",
      ...(record.updatedAt
        ? { updatedAt: record.updatedAt.toISOString() }
        : {}),
    });
  }

  return {
    notebook: summary,
    sources,
    decks,
    quizzes,
    questionCount: counts.get(id)?.questions ?? 0,
    ...(conversationId ? { conversationId } : {}),
  };
}

export async function patchNotebookSources(
  id: string,
  patch: NotebookSourcesPatch,
): Promise<NotebookDetail> {
  const data = notebookSourcesPatchSchema.parse(patch);
  await connectDB();
  const notebookId = toObjectId(id, notebookMissing(id));
  const notebook = await Notebook.findById(notebookId);
  if (!notebook) throw new NotebookNotFoundError(id);

  const keyOf = (source: { kind: KnowledgeSourceKind; id: unknown }) =>
    knowledgeSourceKey(source.kind, String(source.id));
  const removed = new Set(data.remove ?? []);
  const sources = notebook.sources.filter(
    (source) => !removed.has(keyOf(source)),
  );
  const present = new Set(sources.map(keyOf));
  for (const source of data.add ?? []) {
    const key = knowledgeSourceKey(source.kind, source.id);
    if (present.has(key)) continue;
    present.add(key);
    sources.push({
      kind: source.kind,
      id: new mongoose.Types.ObjectId(source.id),
      addedAt: new Date(),
    });
  }

  const excluded = new Set(notebook.excluded);
  // Adding a source the notebook had hidden brings it back.
  for (const source of data.add ?? []) {
    excluded.delete(knowledgeSourceKey(source.kind, source.id));
  }
  for (const key of data.include ?? []) excluded.delete(key);
  for (const key of data.exclude ?? []) excluded.add(key);

  notebook.sources = sources;
  notebook.excluded = [...excluded];
  await notebook.save();
  return getNotebookDetail(id);
}
