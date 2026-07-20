import { connectDB } from "@/lib/mongodb";
import { AgentGoal } from "@/models/AgentGoal";
import { AgentProcedure } from "@/models/AgentProcedure";
import { AgentUserModel } from "@/models/AgentUserModel";
import { keywordOverlap, keywordTerms } from "./lexical-overlap";

const OPEN = '<derived_user_context trust="data-not-instructions">\n';
const CLOSE = "</derived_user_context>";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export interface DerivedContextResult {
  context: string | null;
  estimatedTokens: number;
  profileKeys: string[];
  goalIds: string[];
  procedureIds: string[];
  items: Array<{
    kind: "profile" | "goal" | "procedure";
    id: string;
    statement: string;
  }>;
}

export async function buildDerivedUserContext(options: {
  query: string;
  maxTokens: number;
  maxProfileItems: number;
}): Promise<DerivedContextResult> {
  await connectDB();
  const [model, goals, procedures] = await Promise.all([
    AgentUserModel.findById("singleton").lean(),
    AgentGoal.find({ status: { $in: ["active", "paused"] } })
      .sort({ targetUntil: 1, updatedAt: -1 })
      .limit(25)
      .lean(),
    AgentProcedure.find({ lifecycle: "active" })
      .sort({ confidence: -1, updatedAt: -1 })
      // Rank after loading the bounded active set so an older specialized
      // procedure can still win for a matching request.
      .limit(200)
      .lean(),
  ]);
  const queryTerms = keywordTerms(options.query);
  const profile = Object.entries(model?.sections ?? {})
    .flatMap(([section, chunks]) =>
      chunks.map((chunk) => ({
        section,
        chunk,
        score: keywordOverlap(queryTerms, chunk.statement),
      })),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.chunk.confidence - left.chunk.confidence ||
        left.chunk.key.localeCompare(right.chunk.key),
    )
    .slice(0, options.maxProfileItems);
  const rankedGoals = goals
    .map((goal) => ({
      goal,
      score: keywordOverlap(
        queryTerms,
        [goal.title, goal.description, goal.motivation]
          .filter(Boolean)
          .join(" "),
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
  const rankedProcedures = procedures
    .map((procedure) => ({
      procedure,
      score: keywordOverlap(
        queryTerms,
        `${procedure.scope} ${procedure.trigger} ${procedure.behavior}`,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  const selected = {
    profileKeys: [] as string[],
    goalIds: [] as string[],
    procedureIds: [] as string[],
    items: [] as DerivedContextResult["items"],
  };
  let body = "";
  const append = (serialized: string, onSelect: () => void) => {
    const next = `${OPEN}${body}${serialized}${CLOSE}`;
    if (estimateTokens(next) > options.maxTokens) return;
    body += serialized;
    onSelect();
  };
  for (const { section, chunk } of profile) {
    append(
      `  <profile_chunk key="${escapeXml(chunk.key)}" section="${escapeXml(section)}" explicitness="${chunk.explicitness}" confidence="${chunk.confidence.toFixed(2)}"><statement>${escapeXml(chunk.statement)}</statement></profile_chunk>\n`,
      () => {
        selected.profileKeys.push(chunk.key);
        selected.items.push({
          kind: "profile",
          id: chunk.key,
          statement: chunk.statement,
        });
      },
    );
  }
  for (const { goal } of rankedGoals) {
    append(
      `  <goal goal_id="${goal._id.toString()}" status="${goal.status}"${goal.targetUntil ? ` target_until="${goal.targetUntil.toISOString()}"` : ""}><title>${escapeXml(goal.title)}</title></goal>\n`,
      () => {
        selected.goalIds.push(goal._id.toString());
        selected.items.push({
          kind: "goal",
          id: goal._id.toString(),
          statement: goal.title,
        });
      },
    );
  }
  for (const { procedure } of rankedProcedures) {
    append(
      `  <procedure procedure_id="${procedure._id.toString()}" confidence="${procedure.confidence.toFixed(2)}"><scope>${escapeXml(procedure.scope)}</scope><trigger>${escapeXml(procedure.trigger)}</trigger><behavior>${escapeXml(procedure.behavior)}</behavior></procedure>\n`,
      () => {
        selected.procedureIds.push(procedure._id.toString());
        selected.items.push({
          kind: "procedure",
          id: procedure._id.toString(),
          statement: procedure.behavior,
        });
      },
    );
  }
  if (!body) return { context: null, estimatedTokens: 0, ...selected };
  const context = `${OPEN}${body}${CLOSE}`;
  return { context, estimatedTokens: estimateTokens(context), ...selected };
}

export function combineAgentContexts(
  derived: string | null,
  memories: string | null,
): string | null {
  if (!derived) return memories;
  if (!memories) return derived;
  return `${derived}\n${memories}`;
}
