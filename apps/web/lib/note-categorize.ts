import { anthropic, calculateCost, logLlmUsage } from "@/lib/llm";
import { connectDB } from "@/lib/mongodb";
import { type ILeanNote, Note, type NoteStatus } from "@/models/Note";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const MODEL = "claude-haiku-4-5-20251001";
const SOURCE = "categorize-notes";
const SINGLE_SOURCE = "note-categorize";
const PASS_ALL_THRESHOLD = 20;

export interface CategorizeNoteInput {
  id: string;
  title: string;
  content: string;
}

export interface CategorizeNoteCandidate {
  id: string;
  title: string;
  content: string;
  url?: string;
  groupIds?: string[];
  tags?: string[];
}

export interface CategorizeSeedGroup {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
}

export interface ProposedGroup {
  name: string;
  parentName?: string | null;
}

export interface ProposedEdge {
  toId: string;
  strength: number;
  reason?: string;
}

export interface CategorizedNoteOutput {
  id: string;
  tags: string[];
  joinGroupIds: string[];
  newGroups: ProposedGroup[];
  proposedEdges: ProposedEdge[];
  status: NoteStatus;
}

export interface IncomingNoteCategorizeInput {
  title: string;
  url?: string;
  description?: string;
  siteName?: string;
  content?: string;
}

export interface IncomingNewGroupSpec {
  name: string;
  description?: string;
  parentName?: string | null;
}

export interface IncomingGroupUpdateSpec {
  groupId: string;
  parentName?: string | null;
  rename?: string;
}

export interface IncomingNoteCategorizeResult {
  tags: string[];
  joinGroupIds: string[];
  newGroups: IncomingNewGroupSpec[];
  groupUpdates: IncomingGroupUpdateSpec[];
  relatedNoteIds: string[];
}

interface CategorizeBatchInput {
  notes: CategorizeNoteInput[];
  candidateNotes: CategorizeNoteCandidate[];
  groups: CategorizeSeedGroup[];
  folderTree: string;
}

const SYSTEM_PROMPT = `You are an assistant that categorizes imported markdown notes inside an existing unified knowledge graph.

Return ONLY a JSON array with one object per input note. Each object MUST match:
{
  "id": string,
  "tags": string[],                       // max 2 short lowercase tags
  "joinGroupIds": string[],               // existing group ids only
  "newGroups": [{ "name": string, "parentName"?: string }],
  "proposedEdges": [{ "toId": string, "strength": number, "reason"?: string }], // max 3, no self-edges
  "status": "open" | "archived"
}

Rules:
- Use the provided seed folder tree as background context, not as a hard constraint.
- Prefer existing groups before inventing new ones.
- New group names must be short Title Case concepts.
- Do not emit duplicate tags, group ids, or edges.
- Only propose edges to ids present in the candidate note list.
- Only keep strong edges. strength must be 0-1 and > 0.5 when useful.
- If a note is evergreen, active, or generally useful, keep status "open". Use "archived" only when the note is clearly stale, completed, or obsolete.
- If no tag/group/edge is warranted, return empty arrays.
- Keep tags topic-specific, not generic.
- Never reference a note id that is not in the provided data.`;

const SINGLE_SYSTEM_PROMPT_PASS_ALL = `You are an assistant that categorizes a user's notes and saved links into conceptual groups inside a personal knowledge graph.

Return ONLY a single JSON object with this shape:
{
  "tags": string[],
  "joinGroupIds": string[],
  "newGroups": [{ "name": string, "description"?: string, "parentName"?: string }],
  "groupUpdates": [{ "groupId": string, "parentName"?: string | null, "rename"?: string }],
  "relatedNoteIds": string[]
}

Rules:
- Prefer existing groups before inventing new ones.
- Group names must be short Title Case concepts.
- Tags should be short lowercase topics, max 5.
- relatedNoteIds should only include strong topical overlaps.
- If a broader parent helps organize several narrow sibling groups, you may create it in newGroups and move existing groups under it with groupUpdates.
- parentName must reference an existing group name or another new group name.
- Do not output redundant ancestor groups in joinGroupIds.
- Notes may have a URL or may be pure markdown notes. Categorize based on the combined signal.`;

const SINGLE_SYSTEM_PROMPT_GROUPS_ONLY = `You are an assistant that assigns a note to existing conceptual groups in a personal knowledge graph.

Return ONLY a single JSON object with this shape:
{
  "tags": string[],
  "joinGroupIds": string[],
  "newGroups": [{ "name": string, "description"?: string, "parentName"?: string }],
  "groupUpdates": [],
  "relatedNoteIds": []
}

Rules:
- Strongly prefer existing groups.
- Create at most one new group only when clearly needed.
- Keep tags short and topic-specific.
- Do not output redundant ancestors in joinGroupIds.`;

function buildPrompt({
  notes,
  candidateNotes,
  groups,
  folderTree,
}: CategorizeBatchInput): string {
  return `<seed_folder_tree>
${folderTree}
</seed_folder_tree>

<existing_groups>
${JSON.stringify(groups, null, 2)}
</existing_groups>

<candidate_notes>
${JSON.stringify(candidateNotes, null, 2)}
</candidate_notes>

<notes_to_categorize>
${JSON.stringify(notes, null, 2)}
</notes_to_categorize>

Categorize every note. Return JSON only.`;
}

function buildIncomingPromptPassAll(
  input: IncomingNoteCategorizeInput,
  notes: Array<{
    _id: string;
    title: string;
    url?: string;
    tags: string[];
    groupIds: string[];
    excerpt: string;
  }>,
  groups: Array<{
    _id: string;
    name: string;
    description?: string;
    parentName?: string | null;
    memberCount: number;
  }>,
) {
  return `<existing_groups>
${JSON.stringify(groups, null, 2)}
</existing_groups>

<existing_notes>
${JSON.stringify(notes, null, 2)}
</existing_notes>

<incoming_note>
${JSON.stringify(input, null, 2)}
</incoming_note>

Categorize the incoming note. Return JSON only.`;
}

function buildIncomingPromptGroupsOnly(
  input: IncomingNoteCategorizeInput,
  groups: Array<{
    _id: string;
    name: string;
    description?: string;
    parentName?: string | null;
    memberCount: number;
  }>,
) {
  return `<existing_groups>
${JSON.stringify(groups, null, 2)}
</existing_groups>

<incoming_note>
${JSON.stringify(input, null, 2)}
</incoming_note>

Decide which existing groups the note should join, or propose at most one new group. Return JSON only.`;
}

function buildIncomingRelationsPrompt(
  input: IncomingNoteCategorizeInput,
  notes: Array<{
    _id: string;
    title: string;
    url?: string;
    tags: string[];
    groupIds: string[];
    excerpt: string;
  }>,
) {
  return `<candidate_related_notes>
${JSON.stringify(notes, null, 2)}
</candidate_related_notes>

<incoming_note>
${JSON.stringify(input, null, 2)}
</incoming_note>

Return JSON only: { "relatedNoteIds": string[] }`;
}

function parseJson<T>(text: string): T | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
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

async function callLlm(
  prompt: string,
  system: string,
  source: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = calculateCost(MODEL, inputTokens, outputTokens);

  logLlmUsage({
    llmModel: MODEL,
    inputTokens,
    outputTokens,
    costUsd,
    systemPrompt: system,
    userPrompt: prompt,
    source,
  });

  return response.content
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
}

export async function categorizeNotesBatch(
  input: CategorizeBatchInput,
): Promise<CategorizedNoteOutput[]> {
  if (input.notes.length === 0) return [];

  const prompt = buildPrompt(input);
  const text = await callLlm(prompt, SYSTEM_PROMPT, SOURCE);
  const parsed = parseJson<CategorizedNoteOutput[]>(text);

  if (!parsed) {
    return input.notes.map((note) => ({
      id: note.id,
      tags: [],
      joinGroupIds: [],
      newGroups: [],
      proposedEdges: [],
      status: "open",
    }));
  }

  const byId = new Map(parsed.map((item) => [item.id, item] as const));
  return input.notes.map((note) => {
    const result = byId.get(note.id);
    if (!result) {
      return {
        id: note.id,
        tags: [],
        joinGroupIds: [],
        newGroups: [],
        proposedEdges: [],
        status: "open",
      };
    }

    return {
      id: note.id,
      tags: [...new Set((result.tags ?? []).slice(0, 2))],
      joinGroupIds: [...new Set(result.joinGroupIds ?? [])],
      newGroups: result.newGroups ?? [],
      proposedEdges: (result.proposedEdges ?? [])
        .filter((edge) => edge.toId && edge.toId !== note.id)
        .slice(0, 3),
      status: result.status === "archived" ? "archived" : "open",
    };
  });
}

export async function categorizeIncomingNote(
  input: IncomingNoteCategorizeInput,
): Promise<IncomingNoteCategorizeResult> {
  await connectDB();

  const [notes, groups, totalCount, memberCounts] = await Promise.all([
    Note.find()
      .select("_id title url tags groupIds content")
      .sort({ createdAt: -1 })
      .limit(PASS_ALL_THRESHOLD)
      .lean<ILeanNote[]>()
      .exec(),
    NoteGroup.find()
      .select("_id name description parentId")
      .lean<ILeanNoteGroup[]>()
      .exec(),
    Note.countDocuments(),
    Note.aggregate<{ _id: string; count: number }>([
      { $unwind: "$groupIds" },
      { $group: { _id: { $toString: "$groupIds" }, count: { $sum: 1 } } },
    ]),
  ]);

  const nameById = new Map(
    groups.map((group) => [String(group._id), group.name] as const),
  );
  const countById = new Map(
    memberCounts.map((item) => [item._id, item.count] as const),
  );

  const compactGroups = groups.map((group) => ({
    _id: String(group._id),
    name: group.name,
    description: group.description,
    parentName: group.parentId
      ? (nameById.get(String(group.parentId)) ?? null)
      : null,
    memberCount: countById.get(String(group._id)) ?? 0,
  }));

  const empty: IncomingNoteCategorizeResult = {
    tags: [],
    joinGroupIds: [],
    newGroups: [],
    groupUpdates: [],
    relatedNoteIds: [],
  };

  const compactNotes = notes.map((note) => ({
    _id: String(note._id),
    title: note.title,
    url: note.url,
    tags: note.tags ?? [],
    groupIds: (note.groupIds ?? []).map(String),
    excerpt: (note.content ?? "").slice(0, 160),
  }));

  if (totalCount < PASS_ALL_THRESHOLD) {
    const prompt = buildIncomingPromptPassAll(
      input,
      compactNotes,
      compactGroups,
    );
    const text = await callLlm(
      prompt,
      SINGLE_SYSTEM_PROMPT_PASS_ALL,
      SINGLE_SOURCE,
    );
    const parsed = parseJsonObject<IncomingNoteCategorizeResult>(text);
    return parsed
      ? {
          tags: parsed.tags ?? [],
          joinGroupIds: parsed.joinGroupIds ?? [],
          newGroups: parsed.newGroups ?? [],
          groupUpdates: parsed.groupUpdates ?? [],
          relatedNoteIds: parsed.relatedNoteIds ?? [],
        }
      : empty;
  }

  const prompt = buildIncomingPromptGroupsOnly(input, compactGroups);
  const phaseAText = await callLlm(
    prompt,
    SINGLE_SYSTEM_PROMPT_GROUPS_ONLY,
    SINGLE_SOURCE,
  );
  const phaseA =
    parseJsonObject<IncomingNoteCategorizeResult>(phaseAText) ?? empty;

  let relatedNoteIds: string[] = [];

  if (phaseA.joinGroupIds.length > 0) {
    const groupNotes = await Note.find({
      groupIds: { $in: phaseA.joinGroupIds },
    })
      .select("_id title url tags groupIds content")
      .limit(40)
      .lean<ILeanNote[]>()
      .exec();

    if (groupNotes.length > 0) {
      const relationPrompt = buildIncomingRelationsPrompt(
        input,
        groupNotes.map((note) => ({
          _id: String(note._id),
          title: note.title,
          url: note.url,
          tags: note.tags ?? [],
          groupIds: (note.groupIds ?? []).map(String),
          excerpt: (note.content ?? "").slice(0, 160),
        })),
      );
      const relationText = await callLlm(
        relationPrompt,
        SINGLE_SYSTEM_PROMPT_GROUPS_ONLY,
        SINGLE_SOURCE,
      );
      const relationResult = parseJsonObject<{ relatedNoteIds: string[] }>(
        relationText,
      );
      relatedNoteIds = relationResult?.relatedNoteIds ?? [];
    }
  }

  return {
    tags: phaseA.tags ?? [],
    joinGroupIds: phaseA.joinGroupIds ?? [],
    newGroups: phaseA.newGroups ?? [],
    groupUpdates: [],
    relatedNoteIds,
  };
}
