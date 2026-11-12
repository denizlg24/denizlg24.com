import {
  type KnowledgeSourceKey,
  type KnowledgeSourceKind,
  knowledgeSourceKey,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { Course } from "@/models/Course";
import { Notebook } from "@/models/Notebook";
import { NotebookNotFoundError, toObjectId } from "./errors";

export { NotebookNotFoundError };

export interface EffectiveNotebookSource {
  sourceKey: KnowledgeSourceKey;
  kind: KnowledgeSourceKind;
  id: string;
  origin: "course" | "explicit";
  excluded: boolean;
}

export interface NotebookSourceInputs {
  courseNoteIds: readonly string[];
  sources: readonly { kind: KnowledgeSourceKind; id: string }[];
  excluded: readonly string[];
}

/** Course notes are live and win over an explicit entry for the same note. */
export function effectiveNotebookSources(
  inputs: NotebookSourceInputs,
): EffectiveNotebookSource[] {
  const excluded = new Set(inputs.excluded);
  const result = new Map<KnowledgeSourceKey, EffectiveNotebookSource>();
  const add = (
    kind: KnowledgeSourceKind,
    id: string,
    origin: EffectiveNotebookSource["origin"],
  ) => {
    const sourceKey = knowledgeSourceKey(kind, id);
    if (result.has(sourceKey)) return;
    result.set(sourceKey, {
      sourceKey,
      kind,
      id,
      origin,
      excluded: excluded.has(sourceKey),
    });
  };
  for (const id of inputs.courseNoteIds) add("note", id, "course");
  for (const source of inputs.sources) add(source.kind, source.id, "explicit");
  return [...result.values()];
}

export function effectiveSourceKeys(
  inputs: NotebookSourceInputs,
  includeExcluded = false,
): KnowledgeSourceKey[] {
  return effectiveNotebookSources(inputs)
    .filter((source) => includeExcluded || !source.excluded)
    .map((source) => source.sourceKey);
}

export async function loadCourseNoteIds(
  courseIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (courseIds.length === 0) return new Map();
  const courses = await Course.find({ _id: { $in: courseIds } })
    .select({ noteIds: 1 })
    .lean<{ _id: unknown; noteIds?: unknown[] }[]>();
  return new Map(
    courses.map((course) => [
      String(course._id),
      (course.noteIds ?? []).map(String),
    ]),
  );
}

export async function resolveNotebookSourceKeys(
  notebookId: string,
  opts: { includeExcluded?: boolean } = {},
): Promise<KnowledgeSourceKey[]> {
  const id = toObjectId(
    notebookId,
    () => new NotebookNotFoundError(notebookId),
  );
  await connectDB();
  const notebook = await Notebook.findById(id)
    .select({ courseId: 1, sources: 1, excluded: 1 })
    .lean();
  if (!notebook) throw new NotebookNotFoundError(notebookId);
  const courseNotes = notebook.courseId
    ? await loadCourseNoteIds([String(notebook.courseId)])
    : new Map<string, string[]>();
  return effectiveSourceKeys(
    {
      courseNoteIds: courseNotes.get(String(notebook.courseId)) ?? [],
      sources: notebook.sources.map((source) => ({
        kind: source.kind,
        id: String(source.id),
      })),
      excluded: notebook.excluded,
    },
    opts.includeExcluded,
  );
}
