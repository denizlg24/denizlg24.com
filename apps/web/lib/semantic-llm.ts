import crypto from "node:crypto";
import mongoose, { type QueryFilter } from "mongoose";
import { calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import {
  pruneGroupIds,
  serializeGroup,
  serializeNote,
} from "@/lib/note-route-utils";
import {
  KnowledgeSemanticRun,
  SEMANTIC_DEFAULT_PARAMETERS,
} from "@/models/KnowledgeSemanticRun";
import { KnowledgeSemanticSuggestion } from "@/models/KnowledgeSemanticSuggestion";
import { type ILeanNote, type INote, Note } from "@/models/Note";
import { NoteEdge } from "@/models/NoteEdge";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const SOURCE = "semantic-keyword-llm";
const MAX_NOTE_CONTENT = 4000;
const BULK_LIMIT = 200;

interface SemanticKeywordSyncOptions {
  force?: boolean;
  missingOnly?: boolean;
  limit?: number;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface KeywordResult {
  keywords: string[];
  summary: string;
}

interface SemanticDecision {
  tags: string[];
  joinGroupIds: string[];
  newGroups: Array<{
    name: string;
    description?: string;
    parentName?: string | null;
  }>;
  groupUpdates: Array<{
    groupId: string;
    parentName?: string | null;
    rename?: string;
  }>;
  relatedNoteIds: string[];
  reason: string;
  confidence: number;
}

interface ClassifyResult {
  note: ReturnType<typeof serializeNote>;
  groups: ReturnType<typeof serializeGroup>[];
  classification: {
    model: string;
    keywords: string[];
    summary: string;
    assignedGroupIds: string[];
    suggestedGroupIds: string[];
    suggestedTags: string[];
    appliedTags: string[];
    mode: "applied" | "suggested";
  };
}

function semanticModel() {
  return process.env.SEMANTIC_LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function semanticBaseUrl() {
  return (
    process.env.SEMANTIC_LLM_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
}

function semanticApiKey() {
  return process.env.SEMANTIC_LLM_API_KEY?.trim();
}

function requireSemanticApiKey() {
  const apiKey = semanticApiKey();
  if (!apiKey) {
    throw new Error("SEMANTIC_LLM_API_KEY is not defined");
  }
  return apiKey;
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

function normalizeTags(tags: unknown, max = 5) {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

function normalizeKeywords(keywords: unknown) {
  if (!Array.isArray(keywords)) return [];
  return [
    ...new Set(
      keywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 24);
}

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.65;
}

async function callSemanticLlm(messages: ChatMessage[]) {
  const model = semanticModel();
  const response = await fetch(`${semanticBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireSemanticApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Semantic LLM request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Semantic LLM returned no content");

  const inputTokens = json.usage?.prompt_tokens ?? 0;
  const outputTokens = json.usage?.completion_tokens ?? 0;
  await logLlmUsage({
    llmModel: model,
    inputTokens,
    outputTokens,
    costUsd: calculateCost(model, inputTokens, outputTokens),
    systemPrompt: messages.find((message) => message.role === "system")?.content ?? "",
    userPrompt: messages.find((message) => message.role === "user")?.content ?? "",
    source: SOURCE,
  });

  return { content, model, usage: json.usage };
}

function compactNote(note: ILeanNote) {
  return {
    id: String(note._id),
    title: note.title,
    url: note.url,
    description: note.description,
    siteName: note.siteName,
    class: note.class,
    tags: note.tags ?? [],
    content: (note.content ?? "").slice(0, MAX_NOTE_CONTENT),
  };
}

function groupPath(
  group: ILeanNoteGroup,
  groupsById: Map<string, ILeanNoteGroup>,
) {
  const parts = [group.name];
  let current = group.parentId
    ? groupsById.get(String(group.parentId))
    : undefined;
  while (current) {
    parts.unshift(current.name);
    current = current.parentId
      ? groupsById.get(String(current.parentId))
      : undefined;
  }
  return parts.join(" > ");
}

function compactGroups(groups: ILeanNoteGroup[]) {
  const byId = new Map(groups.map((group) => [String(group._id), group]));
  return groups.map((group) => ({
    id: String(group._id),
    name: group.name,
    path: groupPath(group, byId),
    description: group.description,
    kind: group.kind,
    lockedByUser: group.lockedByUser,
  }));
}

function compactCandidateNotes(
  note: ILeanNote,
  candidates: ILeanNote[],
  keywords: string[],
) {
  const noteGroupIds = new Set((note.groupIds ?? []).map(String));
  const keywordSet = new Set(keywords);
  const tagSet = new Set(note.tags ?? []);

  return candidates
    .filter((candidate) => String(candidate._id) !== String(note._id))
    .map((candidate) => {
      const candidateKeywords = candidate.semanticKeywords ?? [];
      const sharedKeywords = candidateKeywords.filter((keyword) =>
        keywordSet.has(keyword),
      );
      const sharedTags = (candidate.tags ?? []).filter((tag) =>
        tagSet.has(tag),
      );
      const sharedGroups = (candidate.groupIds ?? [])
        .map(String)
        .filter((groupId) => noteGroupIds.has(groupId));
      return {
        id: String(candidate._id),
        title: candidate.title,
        url: candidate.url,
        tags: candidate.tags ?? [],
        groups: (candidate.groupIds ?? []).map(String),
        keywords: candidateKeywords,
        summary: candidate.semanticSummary,
        excerpt: (candidate.content ?? "").slice(0, 240),
        score:
          sharedKeywords.length * 3 +
          sharedTags.length * 2 +
          sharedGroups.length,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 40)
    .map(({ score: _score, ...candidate }) => candidate);
}

function contentHash(note: ILeanNote, model: string) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        model,
        title: note.title,
        url: note.url,
        description: note.description,
        siteName: note.siteName,
        class: note.class,
        tags: note.tags ?? [],
        content: note.content ?? "",
      }),
    )
    .digest("hex");
}

async function generateKeywords(
  note: ILeanNote,
): Promise<KeywordResult & { model: string }> {
  const { content, model } = await callSemanticLlm([
    {
      role: "system",
      content:
        'Extract concise semantic keywords for a personal knowledge note. Return JSON only: {"keywords": string[], "summary": string}. Keywords should be specific, lowercase, and useful for grouping.',
    },
    {
      role: "user",
      content: JSON.stringify({ note: compactNote(note) }),
    },
  ]);
  const parsed = parseJsonObject<KeywordResult>(content);
  if (!parsed) throw new Error("Semantic LLM returned invalid keyword JSON");

  return {
    model,
    keywords: normalizeKeywords(parsed.keywords),
    summary:
      typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "",
  };
}

async function decideGroups({
  note,
  groups,
  candidateNotes,
  keywords,
  summary,
}: {
  note: ILeanNote;
  groups: ILeanNoteGroup[];
  candidateNotes: ILeanNote[];
  keywords: string[];
  summary: string;
}) {
  const { content } = await callSemanticLlm([
    {
      role: "system",
      content:
        'Classify a note into a personal knowledge graph using note keywords, current groups, candidate related notes, and current note metadata. Return JSON only: {"tags": string[], "joinGroupIds": string[], "newGroups": [{"name": string, "description"?: string, "parentName"?: string}], "groupUpdates": [{"groupId": string, "parentName"?: string | null, "rename"?: string}], "relatedNoteIds": string[], "reason": string, "confidence": number}. Prefer existing groups. Create at most one new group. Do not include ancestor groups when a child is more precise. relatedNoteIds must contain at most 3 candidate note IDs with strong direct conceptual overlap worth showing as an inter-note edge; do not include notes that are merely in the same broad group.',
    },
    {
      role: "user",
      content: JSON.stringify({
        note: compactNote(note),
        semantic: { keywords, summary },
        existingGroups: compactGroups(groups),
        candidateRelatedNotes: compactCandidateNotes(
          note,
          candidateNotes,
          keywords,
        ),
      }),
    },
  ]);
  const parsed = parseJsonObject<SemanticDecision>(content);
  if (!parsed)
    throw new Error("Semantic LLM returned invalid classification JSON");

  const validGroupIds = new Set(groups.map((group) => String(group._id)));
  return {
    tags: normalizeTags(parsed.tags),
    joinGroupIds: [...new Set(parsed.joinGroupIds ?? [])].filter((groupId) =>
      validGroupIds.has(groupId),
    ),
    newGroups: (parsed.newGroups ?? [])
      .filter((group) => typeof group.name === "string" && group.name.trim())
      .slice(0, 1),
    groupUpdates: (parsed.groupUpdates ?? []).filter((update) =>
      validGroupIds.has(update.groupId),
    ),
    relatedNoteIds: [...new Set(parsed.relatedNoteIds ?? [])]
      .filter(
        (noteId) =>
          typeof noteId === "string" &&
          mongoose.Types.ObjectId.isValid(noteId) &&
          noteId !== String(note._id),
      )
      .slice(0, 3),
    reason:
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "LLM semantic classification",
    confidence: clampConfidence(parsed.confidence),
  };
}

function hasManualGrouping(
  note: ILeanNote,
  groupsById: Map<string, ILeanNoteGroup>,
) {
  if ((note.manualGroupIds ?? []).length > 0) return true;
  return (note.groupIds ?? []).some((groupId) => {
    const group = groupsById.get(String(groupId));
    return (
      group?.kind === "manual" ||
      group?.source === "user" ||
      group?.lockedByUser
    );
  });
}

async function resolveNewGroups(
  newGroups: SemanticDecision["newGroups"],
  groups: ILeanNoteGroup[],
) {
  const ids: string[] = [];
  for (const proposed of newGroups) {
    const existing = groups.find(
      (group) =>
        group.name.toLowerCase() === proposed.name.trim().toLowerCase(),
    );
    if (existing) {
      ids.push(String(existing._id));
      continue;
    }

    const parent = proposed.parentName
      ? groups.find(
          (group) =>
            group.name.toLowerCase() ===
            proposed.parentName?.trim().toLowerCase(),
        )
      : undefined;
    const created = await NoteGroup.create({
      name: proposed.name.trim(),
      description: proposed.description,
      parentId: parent?._id ?? null,
      autoCreated: true,
      kind: "generated",
      source: "llm",
      lockedByUser: false,
      confidence: 0.75,
    });
    ids.push(String(created._id));
  }
  return ids;
}

async function createReviewSuggestions({
  runId,
  note,
  decision,
  groups,
}: {
  runId: mongoose.Types.ObjectId;
  note: ILeanNote;
  decision: SemanticDecision;
  groups: ILeanNoteGroup[];
}) {
  const existingGroupNames = new Map(
    groups.map((group) => [group.name.toLowerCase(), String(group._id)]),
  );
  let inserted = 0;
  await KnowledgeSemanticSuggestion.updateMany(
    { noteId: note._id, status: "pending" },
    { $set: { status: "superseded", decidedAt: new Date() } },
  ).exec();

  for (const groupId of decision.joinGroupIds) {
    if ((note.groupIds ?? []).map(String).includes(groupId)) continue;
    await KnowledgeSemanticSuggestion.create({
      runId,
      type: "join-group",
      noteId: note._id,
      targetGroupId: groupId,
      confidence: decision.confidence,
      reason: decision.reason,
      source: "llm-label",
    });
    inserted += 1;
  }

  for (const group of decision.newGroups) {
    if (existingGroupNames.has(group.name.toLowerCase())) continue;
    await KnowledgeSemanticSuggestion.create({
      runId,
      type: "create-group",
      noteId: note._id,
      proposedName: group.name,
      proposedDescription: group.description,
      confidence: decision.confidence,
      reason: decision.reason,
      source: "llm-label",
    });
    inserted += 1;
  }

  const newTags = decision.tags.filter(
    (tag) => !(note.tags ?? []).includes(tag),
  );
  if (newTags.length > 0) {
    await KnowledgeSemanticSuggestion.create({
      runId,
      type: "add-tags",
      noteId: note._id,
      proposedTags: newTags,
      confidence: decision.confidence,
      reason: decision.reason,
      source: "llm-label",
    });
    inserted += 1;
  }

  for (const update of decision.groupUpdates) {
    await KnowledgeSemanticSuggestion.create({
      runId,
      type: update.rename ? "rename-group" : "move-group",
      groupId: update.groupId,
      proposedName: update.rename,
      proposedParentId: null,
      confidence: decision.confidence,
      reason: decision.reason,
      source: "llm-label",
    });
    inserted += 1;
  }

  for (const relatedNoteId of decision.relatedNoteIds) {
    const [from, to] =
      String(note._id) < relatedNoteId
        ? [String(note._id), relatedNoteId]
        : [relatedNoteId, String(note._id)];
    const existingEdge = await NoteEdge.exists({ from, to }).exec();
    if (existingEdge) continue;

    await KnowledgeSemanticSuggestion.create({
      runId,
      type: "add-edge",
      noteId: note._id,
      proposedRelatedNoteIds: [new mongoose.Types.ObjectId(relatedNoteId)],
      confidence: decision.confidence,
      reason: decision.reason,
      source: "llm-label",
    });
    inserted += 1;
  }

  return inserted;
}

async function createTagSuggestion({
  note,
  tags,
  reason,
  confidence,
  model,
}: {
  note: ILeanNote;
  tags: string[];
  reason: string;
  confidence: number;
  model: string;
}) {
  if (tags.length === 0) return;
  await KnowledgeSemanticSuggestion.updateMany(
    { noteId: note._id, status: "pending", type: "add-tags" },
    { $set: { status: "superseded", decidedAt: new Date() } },
  ).exec();
  const run = await KnowledgeSemanticRun.create({
    model,
    parameters: SEMANTIC_DEFAULT_PARAMETERS,
    status: "completed",
    initiatedBy: "desktop",
    noteCount: 1,
    embeddedCount: 1,
    staleCount: 1,
    completedAt: new Date(),
  });
  await KnowledgeSemanticSuggestion.create({
    runId: run._id,
    type: "add-tags",
    noteId: note._id,
    proposedTags: tags,
    confidence,
    reason,
    source: "llm-label",
  });
}

export async function classifyNoteWithSemanticLlm(
  noteId: string,
): Promise<ClassifyResult> {
  await connectDB();
  const targetId = new mongoose.Types.ObjectId(noteId);
  const [note, groups, candidateNotes] = await Promise.all([
    Note.findById(targetId).lean<ILeanNote>().exec(),
    NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
    Note.find({ _id: { $ne: targetId } })
      .select(
        "_id title url content tags groupIds semanticKeywords semanticSummary updatedAt",
      )
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean<ILeanNote[]>()
      .exec(),
  ]);
  if (!note) throw new Error("Note not found");

  const keywordResult = await generateKeywords(note);
  const hash = contentHash(note, keywordResult.model);
  const decision = await decideGroups({
    note,
    groups,
    candidateNotes,
    keywords: keywordResult.keywords,
    summary: keywordResult.summary,
  });
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const mode = hasManualGrouping(note, groupsById) ? "suggested" : "applied";
  const appliedTags =
    mode === "applied" && (note.tags ?? []).length === 0 ? decision.tags : [];
  let assignedGroupIds: string[] = [];
  let suggestedGroupIds = decision.joinGroupIds;
  let suggestedTags = decision.tags.filter(
    (tag) => !(note.tags ?? []).includes(tag),
  );

  if (mode === "applied") {
    const createdGroupIds = await resolveNewGroups(decision.newGroups, groups);
    assignedGroupIds = [...decision.joinGroupIds, ...createdGroupIds];
    const groupIds = await pruneGroupIds(assignedGroupIds);
    await Note.findByIdAndUpdate(targetId, {
      $set: {
        groupIds,
        manualGroupIds: [],
        tags: appliedTags,
      },
    }).exec();
    suggestedGroupIds = [];
    if ((note.tags ?? []).length > 0) {
      await createTagSuggestion({
        note,
        tags: suggestedTags,
        reason: decision.reason,
        confidence: decision.confidence,
        model: keywordResult.model,
      });
    } else {
      suggestedTags = [];
    }
  } else {
    const run = await KnowledgeSemanticRun.create({
      model: keywordResult.model,
      parameters: SEMANTIC_DEFAULT_PARAMETERS,
      status: "running",
      initiatedBy: "desktop",
      noteCount: 1,
    });
    await createReviewSuggestions({
      runId: run._id,
      note,
      decision,
      groups,
    });
    await KnowledgeSemanticRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "completed",
        completedAt: new Date(),
        embeddedCount: 1,
        staleCount: 1,
      },
    }).exec();
  }

  const updated = await Note.findByIdAndUpdate(
    targetId,
    {
      $set: {
        semanticKeywords: keywordResult.keywords,
        semanticSummary: keywordResult.summary,
        semanticModel: keywordResult.model,
        semanticStatus: "embedded",
        semanticContentHash: hash,
        semanticUpdatedAt: new Date(),
      },
      $unset: { semanticError: "" },
    },
    { returnDocument: "after", runValidators: true },
  )
    .lean<ILeanNote>()
    .exec();

  const freshGroups = await NoteGroup.find()
    .sort({ name: 1 })
    .lean<ILeanNoteGroup[]>()
    .exec();

  return {
    note: serializeNote(updated ?? note),
    groups: freshGroups.map(serializeGroup),
    classification: {
      model: keywordResult.model,
      keywords: keywordResult.keywords,
      summary: keywordResult.summary,
      assignedGroupIds,
      suggestedGroupIds,
      suggestedTags,
      appliedTags,
      mode,
    },
  };
}

export async function runSemanticKeywordSync({
  force = false,
  missingOnly = false,
  limit,
}: SemanticKeywordSyncOptions = {}) {
  await connectDB();
  const model = semanticModel();
  const effectiveLimit = Math.max(
    1,
    Math.min(limit ?? (force ? 10_000 : BULK_LIMIT), 10_000),
  );
  const run = await KnowledgeSemanticRun.create({
    model,
    parameters: SEMANTIC_DEFAULT_PARAMETERS,
    status: "running",
    initiatedBy: "desktop",
  });

  try {
    const noteFilter: QueryFilter<INote> = missingOnly
      ? {
          semanticStatus: { $ne: "failed" },
          $or: [
            { semanticKeywords: { $exists: false } },
            { semanticKeywords: { $size: 0 } },
            { semanticSummary: { $exists: false } },
            { semanticSummary: "" },
          ],
        }
      : force
        ? {}
        : { semanticStatus: { $in: ["pending", "stale", "failed"] } };
    const [notes, groups, candidateNotes] = await Promise.all([
      Note.find(noteFilter)
        .sort({ updatedAt: -1 })
        .limit(effectiveLimit)
        .lean<ILeanNote[]>()
        .exec(),
      NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
      Note.find()
        .select(
          "_id title url content tags groupIds semanticKeywords semanticSummary updatedAt",
        )
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean<ILeanNote[]>()
        .exec(),
    ]);

    let processed = 0;
    let failed = 0;
    let suggestions = 0;
    for (const note of notes) {
      try {
        const keywordResult = await generateKeywords(note);
        const hash = contentHash(note, keywordResult.model);
        const decision = await decideGroups({
          note,
          groups,
          candidateNotes,
          keywords: keywordResult.keywords,
          summary: keywordResult.summary,
        });
        suggestions += await createReviewSuggestions({
          runId: run._id,
          note,
          decision,
          groups,
        });
        await Note.findByIdAndUpdate(note._id, {
          $set: {
            semanticKeywords: keywordResult.keywords,
            semanticSummary: keywordResult.summary,
            semanticModel: keywordResult.model,
            semanticStatus: "embedded",
            semanticContentHash: hash,
            semanticUpdatedAt: new Date(),
          },
          $unset: { semanticError: "" },
        }).exec();
        processed += 1;
      } catch (error) {
        failed += 1;
        await Note.findByIdAndUpdate(note._id, {
          $set: {
            semanticStatus: "failed",
            semanticError: error instanceof Error ? error.message : "Failed",
          },
        }).exec();
      }
    }

    const completed = await KnowledgeSemanticRun.findByIdAndUpdate(
      run._id,
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          noteCount: notes.length,
          embeddedCount: processed,
          staleCount: notes.length,
          edgeCount: 0,
          clusterCount: suggestions,
        },
      },
      { returnDocument: "after" },
    ).exec();
    const remaining = missingOnly
      ? await Note.countDocuments(noteFilter).exec()
      : 0;

    return {
      run: completed,
      processed,
      failed,
      remaining,
      suggestionCount: suggestions,
    };
  } catch (error) {
    await KnowledgeSemanticRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        error: error instanceof Error ? error.message : "Failed",
      },
    }).exec();
    throw error;
  }
}

export const semanticLlmSource = SOURCE;
