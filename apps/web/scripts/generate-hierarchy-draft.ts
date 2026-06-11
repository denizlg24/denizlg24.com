import mongoose from "mongoose";
import { anthropic, calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import { type ILeanNote, Note } from "@/models/Note";
import { type ILeanNoteEmbedding, NoteEmbedding } from "@/models/NoteEmbedding";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const MODEL = "claude-haiku-4-5-20251001";
const SOURCE = "generate-hierarchy-draft";
const DRAFT_COLLECTION = "knowledge_hierarchy_drafts";
const PREFERRED_EMBEDDING_MODELS = [
  "Xenova/multilingual-e5-small",
  "local-hashing-384-v1",
] as const;
const BATCH_SIZE = 20;
const SIMILARITY_THRESHOLD = 0.62;
const MIN_CLUSTER_SIZE = 2;

interface NoteContext {
  id: string;
  title: string;
  content: string;
  tags: string[];
  oldPaths: string[];
}

interface TitleProposal {
  id: string;
  proposedTitle: string;
  confidence: number;
}

interface ClusterLabel {
  path: string[];
  confidence: number;
}

interface DraftNote {
  noteId: string;
  oldTitle: string;
  proposedTitle: string;
  oldPaths: string[];
  proposedPath: string[];
  tags: string[];
  confidence: number;
}

interface HierarchyDraftDocument {
  _id: string;
  kind: string;
  status: string;
  model: string;
  embeddingModel: string;
  createdAt: Date;
  stats: {
    notes: number;
    oldGroups: number;
    proposedGroups: number;
    renamedNotes: number;
  };
  groups: Array<{ path: string[] }>;
  notes: DraftNote[];
}

function selectEmbeddingModel(embeddings: ILeanNoteEmbedding[]) {
  const counts = new Map<string, number>();

  for (const embedding of embeddings) {
    if (embedding.dimension !== 384) continue;
    counts.set(embedding.model, (counts.get(embedding.model) ?? 0) + 1);
  }

  for (const model of PREFERRED_EMBEDDING_MODELS) {
    if (counts.has(model)) return model;
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function parseJsonObject<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

async function callHaiku<T>({
  system,
  prompt,
}: {
  system: string;
  prompt: string;
}) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter(
      (
        block,
      ): block is Extract<
        (typeof response.content)[number],
        { type: "text" }
      > => block.type === "text",
    )
    .map((block) => block.text)
    .join("");

  const costUsd = calculateCost(
    MODEL,
    response.usage.input_tokens,
    response.usage.output_tokens,
  );

  await logLlmUsage({
    llmModel: MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd,
    systemPrompt: system,
    userPrompt: prompt,
    source: SOURCE,
  });

  return parseJsonObject<T>(text);
}

function buildGroupPathMap(groups: ILeanNoteGroup[]) {
  const byId = new Map(groups.map((group) => [String(group._id), group]));

  return (groupId: string) => {
    const parts: string[] = [];
    let current = byId.get(groupId);
    const seen = new Set<string>();

    while (current && !seen.has(String(current._id))) {
      seen.add(String(current._id));
      parts.unshift(current.name);
      current = current.parentId
        ? byId.get(String(current.parentId))
        : undefined;
    }

    return parts;
  };
}

function isWeakTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return (
    /^aula\s*\d+$/i.test(normalized) ||
    /^aula\d+$/i.test(normalized) ||
    /^notas?$/i.test(normalized) ||
    /^notes?$/i.test(normalized) ||
    /^guide$/i.test(normalized) ||
    /^credentials?$/i.test(normalized) ||
    /^credenciais$/i.test(normalized) ||
    /^reuni[aã]o\s*\d*$/i.test(normalized)
  );
}

function excerpt(note: ILeanNote) {
  return (note.content ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
}

async function proposeTitles(notes: NoteContext[]) {
  const proposals = new Map<string, TitleProposal>();
  const weakNotes = notes.filter((note) => isWeakTitle(note.title));

  for (let index = 0; index < weakNotes.length; index += BATCH_SIZE) {
    const batch = weakNotes.slice(index, index + BATCH_SIZE);
    const parsed = await callHaiku<{ notes: TitleProposal[] }>({
      system:
        "Rename vague personal knowledge notes. Return JSON only. Do not invent facts beyond the provided path, tags, title, and excerpt.",
      prompt: JSON.stringify({
        instructions: [
          "Return { notes: [{ id, proposedTitle, confidence }] }.",
          "Keep the note language consistent with the excerpt and old path.",
          "For lecture notes, include the course/topic and lecture number when useful.",
          "Use 3-10 words.",
          "If the excerpt is vague, use the old path plus the original lecture/meeting number.",
        ],
        notes: batch.map((note) => ({
          id: note.id,
          title: note.title,
          oldPaths: note.oldPaths,
          tags: note.tags,
          excerpt: note.content,
        })),
      }),
    });

    for (const proposal of parsed?.notes ?? []) {
      if (!proposal.id || !proposal.proposedTitle) continue;
      proposals.set(proposal.id, {
        id: proposal.id,
        proposedTitle: proposal.proposedTitle.trim(),
        confidence: Math.max(0, Math.min(1, proposal.confidence ?? 0.6)),
      });
    }
  }

  return proposals;
}

function cosine(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function clusterWithinScope(
  noteIds: string[],
  embeddings: Map<string, number[]>,
) {
  const adjacency = new Map<string, Set<string>>();

  for (const noteId of noteIds) {
    adjacency.set(noteId, new Set());
  }

  for (let leftIndex = 0; leftIndex < noteIds.length; leftIndex += 1) {
    const leftId = noteIds[leftIndex];
    const leftVector = embeddings.get(leftId);
    if (!leftVector) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < noteIds.length;
      rightIndex += 1
    ) {
      const rightId = noteIds[rightIndex];
      const rightVector = embeddings.get(rightId);
      if (!rightVector) continue;

      if (cosine(leftVector, rightVector) >= SIMILARITY_THRESHOLD) {
        adjacency.get(leftId)?.add(rightId);
        adjacency.get(rightId)?.add(leftId);
      }
    }
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const noteId of noteIds) {
    if (visited.has(noteId)) continue;

    const stack = [noteId];
    const cluster: string[] = [];
    visited.add(noteId);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      cluster.push(current);

      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function scopeKey(note: NoteContext) {
  const firstPath = note.oldPaths[0]?.split(" > ") ?? [];
  if (firstPath[0] === "FEUP" && firstPath[1]) {
    return `${firstPath[0]} > ${firstPath[1]}`;
  }

  return firstPath[0] || "Ungrouped";
}

function fallbackClusterPath(
  clusterNotes: NoteContext[],
  titleById: Map<string, string>,
) {
  const first = clusterNotes[0];
  const base = scopeKey(first).split(" > ").filter(Boolean);
  if (clusterNotes.length < MIN_CLUSTER_SIZE) {
    return base.length > 0 ? base : ["Ungrouped"];
  }

  const tagCounts = new Map<string, number>();

  for (const note of clusterNotes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const label =
    [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    titleById.get(first.id) ??
    first.title;

  return [...base, toTitleCase(label)];
}

function toTitleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function labelCluster(
  clusterNotes: NoteContext[],
  titleById: Map<string, string>,
) {
  const fallback = fallbackClusterPath(clusterNotes, titleById);

  const parsed = await callHaiku<{ path: string[]; confidence: number }>({
    system: "Name a clean personal knowledge hierarchy path. Return JSON only.",
    prompt: JSON.stringify({
      instructions: [
        "Return { path: string[], confidence: number }.",
        "Keep useful old top-level/course context such as FEUP and course names.",
        "Remove useless folder names like T, misc, notes, aula, classes.",
        "Use human-readable group names.",
        "Do not create more than 4 path parts.",
      ],
      fallbackPath: fallback,
      notes: clusterNotes.map((note) => ({
        id: note.id,
        title: note.title,
        proposedTitle: titleById.get(note.id) ?? note.title,
        oldPaths: note.oldPaths,
        tags: note.tags,
        excerpt: note.content.slice(0, 400),
      })),
    }),
  });

  const path = (parsed?.path ?? fallback)
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => part.trim())
    .slice(0, 4);

  return {
    path: path.length > 0 ? path : fallback,
    confidence: Math.max(0, Math.min(1, parsed?.confidence ?? 0.55)),
  } satisfies ClusterLabel;
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database connection not available");

  const [notes, groups, allEmbeddings] = await Promise.all([
    Note.find().sort({ createdAt: 1 }).lean<ILeanNote[]>().exec(),
    NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
    NoteEmbedding.find().lean<ILeanNoteEmbedding[]>().exec(),
  ]);

  const embeddingModel = selectEmbeddingModel(allEmbeddings);
  if (!embeddingModel) {
    throw new Error(
      "No 384-dimensional embeddings found. Run semantic sync first.",
    );
  }

  const embeddings = embeddingModel
    ? allEmbeddings.filter((embedding) => embedding.model === embeddingModel)
    : [];

  if (embeddings.length === 0) {
    throw new Error("No embeddings found for selected model.");
  }

  const pathForGroup = buildGroupPathMap(groups);
  const noteContexts = notes.map((note) => ({
    id: String(note._id),
    title: note.title,
    content: excerpt(note),
    tags: note.tags ?? [],
    oldPaths: (note.groupIds ?? [])
      .map((groupId) => pathForGroup(String(groupId)).join(" > "))
      .filter(Boolean),
  }));

  const titleProposals = await proposeTitles(noteContexts);
  const titleById = new Map(
    noteContexts.map((note) => [
      note.id,
      titleProposals.get(note.id)?.proposedTitle ?? note.title,
    ]),
  );
  const embeddingByNoteId = new Map(
    embeddings.map((embedding) => [String(embedding.noteId), embedding.vector]),
  );
  const notesByScope = new Map<string, NoteContext[]>();

  for (const note of noteContexts) {
    const list = notesByScope.get(scopeKey(note)) ?? [];
    list.push(note);
    notesByScope.set(scopeKey(note), list);
  }

  const draftNotes: DraftNote[] = [];
  const groupPathSet = new Set<string>();

  for (const [, scopedNotes] of notesByScope) {
    const clusters = clusterWithinScope(
      scopedNotes.map((note) => note.id),
      embeddingByNoteId,
    );

    for (const clusterIds of clusters) {
      const clusterNotes = clusterIds
        .map((id) => scopedNotes.find((note) => note.id === id))
        .filter((note): note is NoteContext => Boolean(note));

      const label =
        clusterNotes.length >= MIN_CLUSTER_SIZE
          ? await labelCluster(clusterNotes, titleById)
          : {
              path: fallbackClusterPath(clusterNotes, titleById),
              confidence: 0.45,
            };

      groupPathSet.add(label.path.join(" > "));

      for (const note of clusterNotes) {
        const proposal = titleProposals.get(note.id);
        draftNotes.push({
          noteId: note.id,
          oldTitle: note.title,
          proposedTitle: titleById.get(note.id) ?? note.title,
          oldPaths: note.oldPaths,
          proposedPath: label.path,
          tags: note.tags,
          confidence: Math.min(label.confidence, proposal?.confidence ?? 0.8),
        });
      }
    }
  }

  const draftId = `hierarchy-draft:${new Date().toISOString()}`;
  const draft = {
    _id: draftId,
    kind: "hierarchy-draft",
    status: "pending-review",
    model: MODEL,
    embeddingModel,
    createdAt: new Date(),
    stats: {
      notes: draftNotes.length,
      oldGroups: groups.length,
      proposedGroups: groupPathSet.size,
      renamedNotes: titleProposals.size,
    },
    groups: [...groupPathSet]
      .sort()
      .map((path) => ({ path: path.split(" > ") })),
    notes: draftNotes.sort((a, b) =>
      a.proposedPath.join(" > ").localeCompare(b.proposedPath.join(" > ")),
    ),
  };

  await db
    .collection<HierarchyDraftDocument>(DRAFT_COLLECTION)
    .insertOne(draft);

  console.log(
    JSON.stringify(
      {
        draftId,
        stats: draft.stats,
        sampleGroups: draft.groups.slice(0, 20),
        renamedSamples: draft.notes
          .filter((note) => note.oldTitle !== note.proposedTitle)
          .slice(0, 20)
          .map((note) => ({
            oldTitle: note.oldTitle,
            proposedTitle: note.proposedTitle,
            oldPaths: note.oldPaths,
            proposedPath: note.proposedPath,
          })),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Hierarchy draft generation failed:", error);
    process.exit(1);
  });
